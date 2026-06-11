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
import type { GroveConfig } from "./index.js";
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
  BranchDeleteFailedError,
} from "./errors.js";

import type {
  AcquiredSlot,
  AcquireLeaseOptions,
  ReleaseLeaseOptions,
  DestroyLeaseOptions,
  RepairLeaseOptions,
  GroveLease,
  WorktreeStatus,
} from "./types.js";
import { entryToLease, listWorktrees, listLeases, inspectLease } from "./queries.js";

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
        onFailure: this.config.onHookFailure,
      });
    } catch (err: any) {
      if (err.code === "HOOK_FAILED") {
        throw err;
      }
    }
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
        if (options.mode === "branch") {
          if (existing.branch !== options.branch) {
            throw new LeaseConflictError(`Lease conflict: requested branch ${options.branch}, existing has ${existing.branch}`);
          }
        } else if (options.mode === "detached") {
          if (existing.baseRef !== options.ref && existing.baseSha !== options.ref && existing.acquiredHeadSha !== options.ref) {
            throw new LeaseConflictError(`Lease conflict: requested ref ${options.ref} does not match existing detached base or SHA`);
          }
        }

        await reserveOwner(existing);
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
      leaseEnvVars = this.leaseEnv(entryToLease(wt, unverified ? "unverified" : "verified", this.config.repoRoot));
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

    let finalLease: GroveLease | null = null;
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
        const tempId = wt.leaseId; // capture to return lease metadata
        wt.leaseId = undefined;
        finalLease = entryToLease({ ...wt, leaseId: tempId }, "verified", this.config.repoRoot);
      } else if (options.cleanup === "preserve") {
        wt.state = "leased";
      }

      await writeState(this.poolDir, state);
    });

    await this.runHook(this.config.hooks?.postRelease, targetWtPath, leaseEnvVars);

    return finalLease || this.inspect(leaseIdOrPath) as Promise<GroveLease>;
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
      leaseEnvVars = targetWt.leaseId ? this.leaseEnv(entryToLease(targetWt, unverified ? "unverified" : "verified", this.config.repoRoot)) : {};

      await writeState(this.poolDir, state);
    });

    await this.executeDestroy(targetWtPath, leaseEnvVars, branchToDelete, options);
  }

  private async executeDestroy(
    targetWtPath: string,
    leaseEnvVars: Record<string, string>,
    branchToDelete: string | undefined,
    options?: DestroyLeaseOptions
  ): Promise<void> {
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

      let branchDeleteError: any;
      if (branchToDelete) {
        try {
           await deleteBranch(this.config.repoRoot, branchToDelete, options?.force);
        } catch (err) {
           branchDeleteError = err;
        }
      }

      state.worktrees.splice(idx, 1);
      await writeState(this.poolDir, state);
      
      if (branchDeleteError) {
        throw new BranchDeleteFailedError(`Branch deletion failed: ${branchDeleteError.message}`);
      }
    });
  }

  async destroyAll(options?: { force?: boolean }): Promise<void> {
    const targets: { path: string, env: Record<string, string> }[] = [];

    await withStateLock(this.poolDir, async () => {
      const state = await readState(this.poolDir);
      
      // Phase 1: validate all
      for (const wt of state.worktrees) {
        const { inUse, unverified } = await isWorktreeInUse(wt.path);
        const alive = await ownerAlive(wt);

        if (!options?.force) {
          if (inUse || alive || unverified) {
            throw new UnsafeCleanupError(
              `worktree ${wt.path} is in use or unverified. Use --force to override`
            );
          }
        }
      }

      // Phase 2: reserve all
      for (const wt of state.worktrees) {
        wt.destroying = true;
        wt.state = "destroying";
        await reserveOwner(wt);
        const { unverified } = await findInWorktree(wt.path);
        const env = wt.leaseId ? this.leaseEnv(entryToLease(wt, unverified ? "unverified" : "verified", this.config.repoRoot)) : {};
        targets.push({ path: wt.path, env });
      }
      
      await writeState(this.poolDir, state);
    });

    // Phase 3: execute destructs outside the shared lock
    const errors: Error[] = [];
    await Promise.all(
      targets.map(async (target) => {
        try {
          await this.executeDestroy(target.path, target.env, undefined, options);
        } catch (err: any) {
          errors.push(err);
        }
      })
    );

    if (errors.length > 0) {
      throw errors[0]; // Propagate the first failure (e.g. BranchDeleteFailedError)
    }
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
    return inspectLease(leaseIdOrPath, this.poolDir, this.config);
  }

  async list(_options?: { includeProcesses?: boolean }): Promise<WorktreeStatus[]> {
    return listWorktrees(this.poolDir);
  }

  async listLeases(_options?: { includeProcesses?: boolean }): Promise<GroveLease[]> {
    return listLeases(this.poolDir, this.config);
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
