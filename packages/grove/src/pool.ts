import { join, basename, dirname, isAbsolute, relative } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  getDefaultBranch,
  addWorktree,
  resetWorktree,
  removeWorktree,
  isDirty,
  fetchOrigin,
  checkoutBranch,
  checkoutDetached,
  getHeadSha,
  resolveRef,
  deleteBranch,
} from "./git/index.js";
import { withStateLock } from "./lock.js";
import { readState, writeState, healState } from "./state.js";
import { reserveOwner, ownerAlive, isWorktreeInUse, findInWorktree } from "./process/detect.js";
import { runHooks } from "./hooks.js";
import type { GroveConfig, GroveCleanupIntent } from "./index.js";
import type { WorktreeEntry, GroveState } from "./schemas.js";
import {
  GroveExhaustedError,
  WorktreeDestroyingError,
  WorktreeNotManagedError,
  LeaseNotFoundError,
  LeaseConflictError,
  LeaseAlreadyExistsError,
  LeaseQuarantinedError,
  UnsafeCleanupError,
  PathOutsidePoolError,
} from "./errors.js";

export type WorktreeStatusInfo = "available" | "dirty" | "in-use" | "you're here";

export interface AcquiredSlot {
  readonly path: string;
  readonly name: string;
}

export interface WorktreeStatus {
  name: string;
  path: string;
  status: WorktreeStatusInfo;
  processes: { PID: number; Name?: string }[];
}

type AcquireMode =
  | {
      mode: "branch";
      branch: string;
      createBranch?: {
        from: string;
        ifExists?: "reuse" | "fail";
      };
    }
  | {
      mode: "detached";
      ref: string;
    };

export type AcquireLeaseOptions = AcquireMode & {
  leaseId: string;
  ownerId?: string;
  ifLeased?: "return-existing" | "fail";
  fetchOnAcquire?: boolean;
  metadata?: Record<string, string>;
};

export type ReleaseLeaseOptions = GroveCleanupIntent;

export interface DestroyLeaseOptions {
  force?: boolean;
  deleteBranch?: boolean;
}

export interface RepairLeaseOptions {
  leaseId: string;
  action: "quarantine" | "resume-cleanup" | "force-destroy";
  force?: boolean;
}

export interface GroveLease {
  leaseId: string;
  ownerId?: string | undefined;
  slotName: string;
  path: string;
  repoRoot: string;
  branch?: string | undefined;
  baseRef?: string | undefined;
  baseSha?: string | undefined;
  acquiredHeadSha: string;
  currentHeadSha: string;
  state: "leased" | "available" | "releasing" | "destroying" | "quarantined";
  pendingCleanup?: GroveCleanupIntent | undefined;
  processSafety?: "verified" | "unverified" | undefined;
  createdAt: string;
  updatedAt: string;
}

export class Grove {
  constructor(
    public readonly poolDir: string,
    private config: GroveConfig,
  ) {}

  private async runHook(hookNames: string[] | undefined, workDir: string, env: Record<string, string> = {}) {
    if (!hookNames || hookNames.length === 0) return;
    try {
      await runHooks(hookNames, workDir, {
        stdout: process.stderr,
        stderr: process.stderr,
        timeoutMs: this.config.hookTimeoutMs,
        env,
      });
    } catch {}
  }

  private async findOrAllocateSlot(state: GroveState, defaultBranch: string): Promise<{ entry: WorktreeEntry, isNew: boolean }> {
    for (const wt of state.worktrees) {
      if (wt.destroying || wt.state === "destroying" || wt.state === "releasing" || wt.state === "quarantined" || wt.leaseId) continue;
      
      const { inUse } = await isWorktreeInUse(wt.path);
      const alive = await ownerAlive(wt);
      if (inUse || alive) continue;

      const dirty = await isDirty(wt.path);
      if (dirty) continue; 
      
      try {
        await resetWorktree(wt.path, defaultBranch);
      } catch {
        continue;
      }
      return { entry: wt, isNew: false };
    }

    const maxTrees = this.config.maxTrees || 16;
    if (state.worktrees.length >= maxTrees) {
      throw new GroveExhaustedError(`Exhausted worktrees (max ${maxTrees})`);
    }

    const nextId = this.nextName(state);
    const repoName = basename(this.config.repoRoot);
    const wtPath = join(this.poolDir, nextId, repoName);

    await mkdir(dirname(wtPath), { recursive: true });
    await addWorktree(this.config.repoRoot, wtPath, defaultBranch);

    const entry: WorktreeEntry = {
      name: nextId,
      path: wtPath,
      created_at: new Date().toISOString(),
      state: "available",
    };
    state.worktrees.push(entry);

    return { entry, isNew: true };
  }

  async acquire(): Promise<AcquiredSlot>;
  async acquire(options: AcquireLeaseOptions): Promise<GroveLease>;
  async acquire(options?: AcquireLeaseOptions): Promise<AcquiredSlot | GroveLease> {
    const branch = await getDefaultBranch(this.config.repoRoot);

    const shouldFetch = options ? options.fetchOnAcquire !== false : this.config.fetchOnAcquire !== false;
    if (shouldFetch) {
      await fetchOrigin(this.config.repoRoot);
    }

    if (!options) {
      // Ephemeral acquire
      let acquiredPath = "";
      let acquiredName = "";
      let runPostCreate = false;

      await withStateLock(this.poolDir, async () => {
        let state = await readState(this.poolDir);
        state = await healState(state);

        const { entry, isNew } = await this.findOrAllocateSlot(state, branch);

        await reserveOwner(entry);
        entry.state = "available";
        await writeState(this.poolDir, state);

        acquiredPath = entry.path;
        acquiredName = entry.name;
        runPostCreate = isNew;
      });

      if (runPostCreate) {
        await this.runHook(this.config.hooks?.postCreate, acquiredPath);
      }

      return { path: acquiredPath, name: acquiredName };
    }

    // LEASE MODE
    // LEASE MODE
    let targetWtPath = "";
    let isNewSlot = false;
    let returningExisting = false;

    await withStateLock(this.poolDir, async () => {
      let state = await readState(this.poolDir);
      state = await healState(state);

      // Check existing lease
      const existing = state.worktrees.find(w => w.leaseId === options.leaseId);
      if (existing) {
        if (options.ifLeased === "fail") {
          throw new LeaseAlreadyExistsError(`Lease ${options.leaseId} already exists`);
        }
        
        if (existing.state === "quarantined") {
          throw new LeaseQuarantinedError(`Lease ${options.leaseId} is quarantined`);
        }

        if (!existsSync(existing.path)) {
          existing.state = "quarantined";
          await writeState(this.poolDir, state);
          throw new LeaseQuarantinedError(`Lease ${options.leaseId} path missing`);
        }

        // Check compatibility
        if (options.mode === "branch" && existing.branch !== options.branch) {
          throw new LeaseConflictError(`Lease conflict: requested branch ${options.branch}, existing has ${existing.branch}`);
        }

        existing.owner_pid = process.pid;
        existing.owner_started_at = Date.now();
        await writeState(this.poolDir, state);

        targetWtPath = existing.path;
        returningExisting = true;
        return; // we can return existing
      }

      // Need to acquire a new slot for the lease
      const { entry, isNew } = await this.findOrAllocateSlot(state, branch);

      entry.leaseId = options.leaseId;
      entry.ownerId = options.ownerId;
      entry.state = "leased";
      entry.branch = options.mode === "branch" ? options.branch : undefined;
      entry.updatedAt = new Date().toISOString();
      await reserveOwner(entry);

      await writeState(this.poolDir, state);
      targetWtPath = entry.path;
      isNewSlot = isNew;
    });

    if (isNewSlot) {
      await this.runHook(this.config.hooks?.postCreate, targetWtPath);
    }

    if (returningExisting) {
      return this.inspect(options.leaseId) as Promise<GroveLease>;
    }

    // Atomicity: checkout and set head
    try {
      let baseSha: string | undefined;
      let baseRef: string | undefined;

      if (options.mode === "branch") {
        if (options.createBranch) {
          baseRef = options.createBranch.from;
          baseSha = await resolveRef(this.config.repoRoot, baseRef);
        }
        await checkoutBranch(targetWtPath, options.branch, options.createBranch);
      } else {
        baseRef = options.ref;
        baseSha = await resolveRef(this.config.repoRoot, baseRef);
        await checkoutDetached(targetWtPath, options.ref);
      }

      const headSha = await getHeadSha(targetWtPath);

      await withStateLock(this.poolDir, async () => {
        const state = await readState(this.poolDir);
        const wt = state.worktrees.find(w => w.path === targetWtPath);
        if (wt) {
          wt.acquiredHeadSha = headSha;
          wt.currentHeadSha = headSha;
          wt.baseRef = baseRef;
          wt.baseSha = baseSha;
          await writeState(this.poolDir, state);
        }
      });
    } catch (err) {
      // Quarantine on failure
      await withStateLock(this.poolDir, async () => {
        const state = await readState(this.poolDir);
        const wt = state.worktrees.find(w => w.path === targetWtPath);
        if (wt) {
          wt.state = "quarantined";
          await writeState(this.poolDir, state);
        }
      });
      throw err;
    }

    const leaseData = await this.inspect(options.leaseId) as GroveLease;
    
    await this.runHook(this.config.hooks?.postAcquire, targetWtPath, this.leaseEnv(leaseData));

    return leaseData;
  }

  async release(path: string): Promise<void>;
  async release(leaseIdOrPath: string, options: ReleaseLeaseOptions): Promise<GroveLease>;
  async release(leaseIdOrPath: string, options?: ReleaseLeaseOptions): Promise<void | GroveLease> {
    if (!options) {
      // Ephemeral release
      const branch = await getDefaultBranch(this.config.repoRoot);

      await withStateLock(this.poolDir, async () => {
        const state = await readState(this.poolDir);
        const wt = state.worktrees.find((w) => w.path === leaseIdOrPath);
        if (!wt) {
          throw new WorktreeNotManagedError(`worktree ${leaseIdOrPath} is not managed by grove`);
        }
        if (wt.destroying || wt.state === "destroying") {
          throw new WorktreeDestroyingError(`worktree ${leaseIdOrPath} is being destroyed`);
        }
      });

      await resetWorktree(leaseIdOrPath, branch);

      await withStateLock(this.poolDir, async () => {
        const state = await readState(this.poolDir);
        const wt = state.worktrees.find((w: any) => w.path === leaseIdOrPath);
        if (!wt) return;
        wt.owner_pid = undefined;
        wt.owner_started_at = undefined;
        wt.state = "available";
        wt.leaseId = undefined;
        await writeState(this.poolDir, state);
      });
      return;
    }

    // LEASE MODE RELEASE
    let targetWtPath = "";
    let leaseEnvVars: Record<string, string> = {};

    await withStateLock(this.poolDir, async () => {
      const state = await readState(this.poolDir);
      const wt = state.worktrees.find(w => w.leaseId === leaseIdOrPath || w.path === leaseIdOrPath);
      if (!wt || !wt.leaseId) {
        throw new LeaseNotFoundError(`Lease ${leaseIdOrPath} not found`);
      }
      
      const { inUse, unverified } = await isWorktreeInUse(wt.path);
      const alive = await ownerAlive(wt);

      if (options.cleanup === "reset" && !options.force) {
        if (inUse || alive || unverified) {
          throw new UnsafeCleanupError(`Unsafe cleanup: active processes or unverified safety. Use force: true.`);
        }
      }

      wt.state = "releasing";
      wt.pendingCleanup = options;
      await writeState(this.poolDir, state);
      targetWtPath = wt.path;
      leaseEnvVars = this.leaseEnv(this.entryToLease(wt, unverified ? "unverified" : "verified"));
    });

    await this.runHook(this.config.hooks?.preRelease, targetWtPath, leaseEnvVars);

    try {
      if (options.cleanup === "reset") {
        await resetWorktree(targetWtPath, options.resetTo || await getDefaultBranch(this.config.repoRoot));
      }
      // quarantine handles marking unusable, preserve does nothing to files
    } catch (err) {
      await withStateLock(this.poolDir, async () => {
        const state = await readState(this.poolDir);
        const wt = state.worktrees.find(w => w.path === targetWtPath);
        if (wt) {
          wt.state = "quarantined";
          await writeState(this.poolDir, state);
        }
      });
      throw new UnsafeCleanupError(`Cleanup failed: ${(err as any).message}`);
    }

    await withStateLock(this.poolDir, async () => {
      const state = await readState(this.poolDir);
      const wt = state.worktrees.find(w => w.path === targetWtPath);
      if (!wt) return;

      wt.owner_pid = undefined;
      wt.owner_started_at = undefined;
      wt.pendingCleanup = undefined;
      
      if (options.cleanup === "quarantine") {
        wt.state = "quarantined";
      } else if (options.cleanup === "reset") {
        wt.state = "available";
        wt.leaseId = undefined;
      } else if (options.cleanup === "preserve") {
        wt.state = "leased";
      }

      await writeState(this.poolDir, state);
    });

    await this.runHook(this.config.hooks?.postRelease, targetWtPath, leaseEnvVars);

    return this.inspect(leaseIdOrPath) as Promise<GroveLease>;
  }

  async destroy(leaseIdOrPath: string, options?: DestroyLeaseOptions): Promise<void> {
    let targetWtPath = "";
    let leaseEnvVars: Record<string, string> = {};
    let branchToDelete: string | undefined;

    await withStateLock(this.poolDir, async () => {
      const state = await readState(this.poolDir);
      const idx = state.worktrees.findIndex(w => w.leaseId === leaseIdOrPath || w.path === leaseIdOrPath);
      const targetWt = state.worktrees[idx];
      
      if (!targetWt) {
        throw new WorktreeNotManagedError(`worktree ${leaseIdOrPath} not managed by grove`);
      }

      const { inUse, unverified } = await isWorktreeInUse(targetWt.path);
      const alive = await ownerAlive(targetWt);

      if (!options?.force) {
        if (inUse || alive || unverified) {
          throw new UnsafeCleanupError(
            `worktree ${targetWt.path} is in use or unverified. Use --force to override`
          );
        }
      }

      if (options?.deleteBranch && targetWt.branch) {
        const safePrefixes = this.config.safeDeleteBranchPrefixes || [];
        if (!safePrefixes.some(p => targetWt.branch!.startsWith(p))) {
          throw new UnsafeCleanupError(`Branch ${targetWt.branch} does not match safe-delete prefixes`);
        }
        branchToDelete = targetWt.branch;
      }

      targetWt.destroying = true;
      targetWt.state = "destroying";
      await reserveOwner(targetWt);
      
      targetWtPath = targetWt.path;
      leaseEnvVars = targetWt.leaseId ? this.leaseEnv(this.entryToLease(targetWt, unverified ? "unverified" : "verified")) : {};

      await writeState(this.poolDir, state);
    });

    await this.runHook(this.config.hooks?.preDestroy, targetWtPath, leaseEnvVars);

    await withStateLock(this.poolDir, async () => {
      const state = await readState(this.poolDir);
      const idx = state.worktrees.findIndex((wt) => wt.path === targetWtPath);
      const wt = state.worktrees[idx];
      if (!wt) return;
      if (!wt.destroying && wt.state !== "destroying") return;

      try {
        await removeWorktree(this.config.repoRoot, targetWtPath);
      } catch {}

      this.assertPathWithinPool(this.poolDir, targetWtPath);
      try {
        await rm(dirname(targetWtPath), { recursive: true, force: true });
      } catch {}

      if (branchToDelete) {
        try {
           await deleteBranch(this.config.repoRoot, branchToDelete, options?.force);
        } catch {} // best effort delete
      }

      state.worktrees.splice(idx, 1);
      await writeState(this.poolDir, state);
    });
  }

  async destroyAll(options?: { force?: boolean }): Promise<void> {
    const state = await readState(this.poolDir);
    await Promise.all(
      state.worktrees.map(wt => this.destroy(wt.leaseId || wt.path, options))
    );
  }

  async repair(options: RepairLeaseOptions): Promise<GroveLease | void> {
    await withStateLock(this.poolDir, async () => {
      const state = await readState(this.poolDir);
      const wt = state.worktrees.find(w => w.leaseId === options.leaseId);
      if (!wt) throw new LeaseNotFoundError(`Lease ${options.leaseId} not found`);

      const { inUse, unverified } = await isWorktreeInUse(wt.path);
      const alive = await ownerAlive(wt);

      if (options.action === "force-destroy") {
        if (!options.force && (inUse || alive || unverified)) {
           throw new UnsafeCleanupError("Cannot force-destroy: processes running or unverified. Use force: true");
        }
      }

      if (options.action === "quarantine") {
        wt.state = "quarantined";
        wt.pendingCleanup = undefined;
        await writeState(this.poolDir, state);
        return;
      }

      if (options.action === "resume-cleanup") {
        if (!wt.pendingCleanup) {
          throw new UnsafeCleanupError("No pending cleanup to resume");
        }
        // we will let the outside call handle it, just leave state as is
      }
      
      if (options.action === "force-destroy") {
        // Handled by explicit call outside
      }
    });

    if (options.action === "resume-cleanup") {
       const wt = await this.inspect(options.leaseId);
       if (wt?.pendingCleanup) {
         return this.release(options.leaseId, wt.pendingCleanup as any);
       }
    }

    if (options.action === "force-destroy") {
       await this.destroy(options.leaseId, { force: true });
       return;
    }

    const res = await this.inspect(options.leaseId);
    if (!res) throw new LeaseNotFoundError("Lease not found after repair");
    return res;
  }

  async inspect(leaseIdOrPath: string): Promise<GroveLease | null> {
    let entry: WorktreeEntry | undefined;
    let processSafety: "verified" | "unverified" = "verified";

    await withStateLock(this.poolDir, async () => {
      let state = await readState(this.poolDir);
      state = await healState(state);
      
      entry = state.worktrees.find(w => w.leaseId === leaseIdOrPath || w.path === leaseIdOrPath);
    });

    if (!entry || !entry.leaseId) return null;

    const { unverified } = await isWorktreeInUse(entry.path);
    if (unverified) processSafety = "unverified";

    try {
      const headSha = await getHeadSha(entry.path);
      entry.currentHeadSha = headSha;
    } catch {}

    return this.entryToLease(entry, processSafety);
  }

  async list(_options?: { includeProcesses?: boolean }): Promise<WorktreeStatus[]> {
    const result: WorktreeStatus[] = [];

    await withStateLock(this.poolDir, async () => {
      let state = await readState(this.poolDir);
      state = await healState(state);
      await writeState(this.poolDir, state);

      const cwd = process.cwd();

      for (const wt of state.worktrees) {
        if (wt.destroying || wt.state === "destroying" || wt.leaseId) continue;

        let status: WorktreeStatusInfo = "available";
        const { processes } = await findInWorktree(wt.path);

        const alive = await ownerAlive(wt);

        if (alive) {
          status = "in-use";
        } else if (processes.length > 0) {
          status = "in-use";
          if (this.cwdInWorktree(cwd, wt.path)) {
            status = "you're here";
          }
        } else if (await isDirty(wt.path)) {
          status = "dirty";
        }

        result.push({
          name: wt.name,
          path: wt.path,
          status,
          processes,
        });
      }
    });

    return result;
  }

  async listLeases(_options?: { includeProcesses?: boolean }): Promise<GroveLease[]> {
    const result: GroveLease[] = [];

    await withStateLock(this.poolDir, async () => {
      let state = await readState(this.poolDir);
      state = await healState(state);

      for (const wt of state.worktrees) {
        if (!wt.leaseId) continue;
        
        const { unverified } = await findInWorktree(wt.path);
        
        try {
          wt.currentHeadSha = await getHeadSha(wt.path);
        } catch {}

        result.push(this.entryToLease(wt, unverified ? "unverified" : "verified"));
      }
    });

    return result;
  }

  async findByPath(worktreePath: string): Promise<WorktreeEntry | null> {
    const state = await readState(this.poolDir);
    for (const wt of state.worktrees) {
      if (wt.path === worktreePath) {
        return wt;
      }
    }
    return null;
  }

  private nextName(state: any): string {
    let max = 0;
    for (const wt of state.worktrees) {
      const n = parseInt(wt.name, 10);
      if (!isNaN(n) && n > max) {
        max = n;
      }
    }
    return (max + 1).toString();
  }

  private cwdInWorktree(cwd: string, worktreePath: string): boolean {
    const rel = relative(worktreePath, cwd);
    return !rel.startsWith("..") && !isAbsolute(rel);
  }

  private assertPathWithinPool(poolDir: string, targetPath: string): void {
    const rel = relative(poolDir, targetPath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new PathOutsidePoolError("Security violation: target path is outside the pool boundary");
    }
  }

  private entryToLease(wt: WorktreeEntry, processSafety: "verified" | "unverified"): GroveLease {
    return {
      leaseId: wt.leaseId!,
      ownerId: wt.ownerId,
      slotName: wt.name,
      path: wt.path,
      repoRoot: this.config.repoRoot,
      branch: wt.branch,
      baseRef: wt.baseRef,
      baseSha: wt.baseSha,
      acquiredHeadSha: wt.acquiredHeadSha || "",
      currentHeadSha: wt.currentHeadSha || "",
      state: (wt.state as any) || "available",
      pendingCleanup: wt.pendingCleanup,
      processSafety,
      createdAt: wt.created_at,
      updatedAt: wt.updatedAt || wt.created_at,
    };
  }

  private leaseEnv(lease: GroveLease): Record<string, string> {
    const e: Record<string, string> = {
      GROVE_LEASE_ID: lease.leaseId,
      GROVE_SLOT_NAME: lease.slotName,
      GROVE_REPO_ROOT: lease.repoRoot,
      GROVE_WORKTREE_PATH: lease.path,
    };
    if (lease.branch) e.GROVE_BRANCH = lease.branch;
    return e;
  }
}
