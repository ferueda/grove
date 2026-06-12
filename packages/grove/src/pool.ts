import { dirname, isAbsolute, relative } from "node:path";
import { rm } from "node:fs/promises";
import {
  getDefaultBranch,
  resetWorktree,
  removeWorktree,
  fetchOrigin,
  deleteBranch,
} from "./git/index.js";
import { withStateLock } from "./lock.js";
import { reserveOwner, ownerAlive, isWorktreeInUse, findInWorktree } from "./process/detect.js";
import { runHooks } from "./hooks.js";
import type { GroveConfig } from "./index.js";
import type { GroveSlot, LeaseFirstCleanupIntent } from "./schemas.js";
import {
  WorktreeDestroyingError,
  WorktreeNotManagedError,
  LeaseNotFoundError,
  UnsafeCleanupError,
  PathOutsidePoolError,
  BranchDeleteFailedError,
  RepairNotAvailableError,
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
import { acquireLease, resumeAcquireLease } from "./lease-acquire.js";
import { inspectLeaseRecord, listLeaseRecords, recordToGroveLease } from "./lease-view.js";
import {
  clearSlotOwner,
  findLease,
  findOrAllocateSlot,
  findSlot,
  leaseForSlot,
  loadPoolState,
  savePoolState,
  slotToWorktreeEntry,
} from "./pool-state.js";
import { transitionLease, transitionSlot } from "./transitions.js";

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

  async acquire(): Promise<AcquiredSlot>;
  async acquire(options: AcquireLeaseOptions): Promise<GroveLease>;
  async acquire(options?: AcquireLeaseOptions): Promise<AcquiredSlot | GroveLease> {
    const shouldFetch = options ? options.fetchOnAcquire !== false : this.config.fetchOnAcquire !== false;
    if (shouldFetch) {
      await fetchOrigin(this.config.repoRoot);
    }

    if (!options) {
      const branch = await getDefaultBranch(this.config.repoRoot);
      let acquiredPath = "";
      let acquiredName = "";
      let runPostCreate = false;

      await withStateLock(this.poolDir, async () => {
        const state = await loadPoolState(this.poolDir, this.config.repoRoot);
        const { slot, isNew } = await findOrAllocateSlot(state, this.poolDir, this.config, branch);
        const ownerEntry = slotToWorktreeEntry(slot);
        await reserveOwner(ownerEntry);
        slot.ownerPid = ownerEntry.owner_pid;
        slot.ownerStartedAt = ownerEntry.owner_started_at;
        await savePoolState(this.poolDir, state);
        acquiredPath = slot.path;
        acquiredName = slot.slotName;
        runPostCreate = isNew;
      });

      if (runPostCreate) {
        await this.runHook(this.config.hooks?.postCreate, acquiredPath);
      }

      return { path: acquiredPath, name: acquiredName };
    }

    return acquireLease(this.poolDir, this.config, options, {
      postCreate: (path) => this.runHook(this.config.hooks?.postCreate, path),
      postAcquire: (path, lease) =>
        this.runHook(this.config.hooks?.postAcquire, path, this.leaseEnv(lease)),
    });
  }

  async release(path: string): Promise<void>;
  async release(leaseIdOrPath: string, options: ReleaseLeaseOptions): Promise<GroveLease>;
  async release(leaseIdOrPath: string, options?: ReleaseLeaseOptions): Promise<void | GroveLease> {
    if (!options) {
      const branch = await getDefaultBranch(this.config.repoRoot);

      await withStateLock(this.poolDir, async () => {
        const state = await loadPoolState(this.poolDir, this.config.repoRoot);
        const slot = state.slots.find((entry) => entry.path === leaseIdOrPath);
        if (!slot) {
          throw new WorktreeNotManagedError(`worktree ${leaseIdOrPath} is not managed by grove`);
        }
        if (slot.state === "destroying") {
          throw new WorktreeDestroyingError(`worktree ${leaseIdOrPath} is being destroyed`);
        }
      });

      await resetWorktree(leaseIdOrPath, branch);

      await withStateLock(this.poolDir, async () => {
        const state = await loadPoolState(this.poolDir, this.config.repoRoot);
        const slot = state.slots.find((entry) => entry.path === leaseIdOrPath);
        if (!slot) return;
        await clearSlotOwner(slot);
        slot.state = "available";
        slot.updatedAt = new Date().toISOString();
        await savePoolState(this.poolDir, state);
      });
      return;
    }

    let targetWtPath = "";
    let leaseEnvVars: Record<string, string> = {};

    await withStateLock(this.poolDir, async () => {
      const state = await loadPoolState(this.poolDir, this.config.repoRoot);
      const lease =
        findLease(state, leaseIdOrPath) ??
        state.leases.find((entry) => entry.path === leaseIdOrPath);
      if (!lease) {
        throw new LeaseNotFoundError(`Lease ${leaseIdOrPath} not found`);
      }

      const slot = findSlot(state, lease.slotName);
      if (!slot) {
        throw new LeaseNotFoundError(`Lease ${leaseIdOrPath} slot not found`);
      }

      const { inUse, unverified } = await isWorktreeInUse(slot.path);
      const alive = await ownerAlive(slotToWorktreeEntry(slot, lease));

      if (options.cleanup === "reset" && !options.force) {
        if (inUse || alive || unverified) {
          throw new UnsafeCleanupError(
            `Unsafe cleanup: active processes or unverified safety. Use force: true.`,
          );
        }
      }

      const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === lease.leaseId);
      state.leases[leaseIndex] = transitionLease(lease, {
        type: "RELEASE_START",
        cleanup: options as LeaseFirstCleanupIntent,
      })!;
      await savePoolState(this.poolDir, state);
      targetWtPath = slot.path;
      leaseEnvVars = this.leaseEnv(recordToGroveLease(lease, unverified ? "unverified" : "verified"));
    });

    await this.runHook(this.config.hooks?.preRelease, targetWtPath, leaseEnvVars);

    try {
      if (options.cleanup === "reset") {
        await resetWorktree(
          targetWtPath,
          options.resetTo || (await getDefaultBranch(this.config.repoRoot)),
        );
      }
    } catch (err) {
      await withStateLock(this.poolDir, async () => {
        const state = await loadPoolState(this.poolDir, this.config.repoRoot);
        const lease = state.leases.find((entry) => entry.path === targetWtPath);
        const slot = lease ? findSlot(state, lease.slotName) : undefined;
        if (lease && slot) {
          const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === lease.leaseId);
          state.leases[leaseIndex] = transitionLease(lease, {
            type: "RELEASE_FAILED",
            reason: (err as Error).message,
          })!;
          const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
          state.slots[slotIndex] = transitionSlot(slot, {
            type: "QUARANTINE",
            reason: (err as Error).message,
          })!;
          await savePoolState(this.poolDir, state);
        }
      });
      throw new UnsafeCleanupError(`Cleanup failed: ${(err as Error).message}`);
    }

    let finalLease: GroveLease | null = null;
    await withStateLock(this.poolDir, async () => {
      const state = await loadPoolState(this.poolDir, this.config.repoRoot);
      const lease = state.leases.find((entry) => entry.path === targetWtPath);
      if (!lease) return;
      const slot = findSlot(state, lease.slotName);
      if (!slot) return;

      await clearSlotOwner(slot);

      if (options.cleanup === "quarantine") {
        const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === lease.leaseId);
        state.leases[leaseIndex] = transitionLease(lease, {
          type: "QUARANTINE",
          reason: "release quarantine",
        })!;
        const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
        state.slots[slotIndex] = transitionSlot(slot, { type: "QUARANTINE" })!;
      } else if (options.cleanup === "reset") {
        const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === lease.leaseId);
        finalLease = recordToGroveLease(state.leases[leaseIndex]!);
        state.leases.splice(leaseIndex, 1);
        const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
        state.slots[slotIndex] = transitionSlot(slot, { type: "RELEASE_TO_POOL" })!;
      } else if (options.cleanup === "preserve") {
        const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === lease.leaseId);
        state.leases[leaseIndex] = transitionLease(lease, {
          type: "RELEASE_PRESERVE_COMPLETE",
        })!;
      }

      await savePoolState(this.poolDir, state);
    });

    await this.runHook(this.config.hooks?.postRelease, targetWtPath, leaseEnvVars);

    if (finalLease) return finalLease;
    return this.inspect(leaseIdOrPath) as Promise<GroveLease>;
  }

  async destroy(leaseIdOrPath: string, options?: DestroyLeaseOptions): Promise<void> {
    let targetWtPath = "";
    let leaseEnvVars: Record<string, string> = {};
    let branchToDelete: string | undefined;
    let slotName = "";

    await withStateLock(this.poolDir, async () => {
      const state = await loadPoolState(this.poolDir, this.config.repoRoot);
      const lease =
        findLease(state, leaseIdOrPath) ??
        state.leases.find((entry) => entry.path === leaseIdOrPath);
      const slot = lease
        ? findSlot(state, lease.slotName)
        : state.slots.find((entry) => entry.path === leaseIdOrPath);

      if (!slot) {
        throw new WorktreeNotManagedError(`worktree ${leaseIdOrPath} not managed by grove`);
      }

      const { inUse, unverified } = await isWorktreeInUse(slot.path);
      const alive = await ownerAlive(slotToWorktreeEntry(slot, lease));

      if (!options?.force) {
        if (inUse || alive || unverified) {
          throw new UnsafeCleanupError(
            `worktree ${slot.path} is in use or unverified. Use --force to override`,
          );
        }
      }

      if (options?.deleteBranch && lease?.target?.mode === "branch") {
        const branchTarget = lease.target;
        const safePrefixes = this.config.safeDeleteBranchPrefixes || [];
        if (!safePrefixes.some((p) => branchTarget.branch.startsWith(p))) {
          throw new UnsafeCleanupError(
            `Branch ${branchTarget.branch} does not match safe-delete prefixes`,
          );
        }
        branchToDelete = branchTarget.branch;
      }

      if (lease) {
        const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === lease.leaseId);
        state.leases[leaseIndex] = transitionLease(lease, { type: "DESTROY_START" })!;
      }
      const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
      state.slots[slotIndex] = transitionSlot(slot, { type: "DESTROY_START" })!;
      const ownerEntry = slotToWorktreeEntry(state.slots[slotIndex]!, lease);
      await reserveOwner(ownerEntry);
      state.slots[slotIndex]!.ownerPid = ownerEntry.owner_pid;
      state.slots[slotIndex]!.ownerStartedAt = ownerEntry.owner_started_at;

      targetWtPath = slot.path;
      slotName = slot.slotName;
      leaseEnvVars = lease
        ? this.leaseEnv(recordToGroveLease(lease, unverified ? "unverified" : "verified"))
        : {};

      await savePoolState(this.poolDir, state);
    });

    await this.executeDestroy(targetWtPath, slotName, leaseEnvVars, branchToDelete, options);
  }

  private async executeDestroy(
    targetWtPath: string,
    slotName: string,
    leaseEnvVars: Record<string, string>,
    branchToDelete: string | undefined,
    options?: DestroyLeaseOptions,
  ): Promise<void> {
    await this.runHook(this.config.hooks?.preDestroy, targetWtPath, leaseEnvVars);

    await withStateLock(this.poolDir, async () => {
      const state = await loadPoolState(this.poolDir, this.config.repoRoot);
      const slot = findSlot(state, slotName);
      const lease = leaseForSlot(state, slotName);
      if (!slot || slot.state !== "destroying") return;

      try {
        await removeWorktree(this.config.repoRoot, targetWtPath);
      } catch {}

      this.assertPathWithinPool(this.poolDir, targetWtPath);
      try {
        await rm(dirname(targetWtPath), { recursive: true, force: true });
      } catch {}

      let branchDeleteError: Error | undefined;
      if (branchToDelete) {
        try {
          await deleteBranch(this.config.repoRoot, branchToDelete, options?.force);
        } catch (err) {
          branchDeleteError = err as Error;
        }
      }

      if (lease) {
        const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === lease.leaseId);
        state.leases.splice(leaseIndex, 1);
      }
      const slotIndex = state.slots.findIndex((entry) => entry.slotName === slotName);
      state.slots.splice(slotIndex, 1);

      await savePoolState(this.poolDir, state);

      if (branchDeleteError) {
        throw new BranchDeleteFailedError(`Branch deletion failed: ${branchDeleteError.message}`);
      }
    });
  }

  async destroyAll(options?: { force?: boolean }): Promise<void> {
    const targets: { path: string; slotName: string; env: Record<string, string> }[] = [];

    await withStateLock(this.poolDir, async () => {
      const state = await loadPoolState(this.poolDir, this.config.repoRoot);

      for (const slot of state.slots) {
        const lease = leaseForSlot(state, slot.slotName);
        const { inUse, unverified } = await isWorktreeInUse(slot.path);
        const alive = await ownerAlive(slotToWorktreeEntry(slot, lease));

        if (!options?.force) {
          if (inUse || alive || unverified) {
            throw new UnsafeCleanupError(
              `worktree ${slot.path} is in use or unverified. Use --force to override`,
            );
          }
        }
      }

      for (const slot of state.slots) {
        const lease = leaseForSlot(state, slot.slotName);
        const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
        if (lease) {
          const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === lease.leaseId);
          state.leases[leaseIndex] = transitionLease(lease, { type: "DESTROY_START" })!;
        }
        state.slots[slotIndex] = transitionSlot(slot, { type: "DESTROY_START" })!;
        const ownerEntry = slotToWorktreeEntry(state.slots[slotIndex]!, lease);
        await reserveOwner(ownerEntry);
        state.slots[slotIndex]!.ownerPid = ownerEntry.owner_pid;
        state.slots[slotIndex]!.ownerStartedAt = ownerEntry.owner_started_at;
        const { unverified } = await findInWorktree(slot.path);
        const env = lease
          ? this.leaseEnv(recordToGroveLease(lease, unverified ? "unverified" : "verified"))
          : {};
        targets.push({ path: slot.path, slotName: slot.slotName, env });
      }

      await savePoolState(this.poolDir, state);
    });

    const errors: Error[] = [];
    for (const target of targets) {
      try {
        await this.executeDestroy(target.path, target.slotName, target.env, undefined, options);
      } catch (err: any) {
        errors.push(err);
      }
    }

    if (errors.length > 0) {
      throw errors[0];
    }
  }

  async repair(options: RepairLeaseOptions): Promise<GroveLease | void> {
    if (options.action === "resume-acquire") {
      return resumeAcquireLease(this.poolDir, this.config, options.leaseId, {
        postAcquire: (path, lease) =>
          this.runHook(this.config.hooks?.postAcquire, path, this.leaseEnv(lease)),
      });
    }

    await withStateLock(this.poolDir, async () => {
      const state = await loadPoolState(this.poolDir, this.config.repoRoot);
      const lease = findLease(state, options.leaseId);
      if (!lease) throw new LeaseNotFoundError(`Lease ${options.leaseId} not found`);

      const slot = findSlot(state, lease.slotName);
      const { inUse, unverified } = slot
        ? await isWorktreeInUse(slot.path)
        : { inUse: false, unverified: false };
      const alive = slot ? await ownerAlive(slotToWorktreeEntry(slot, lease)) : false;

      if (options.action === "force-destroy") {
        if (!options.force && (inUse || alive || unverified)) {
          throw new UnsafeCleanupError(
            "Cannot force-destroy: processes running or unverified. Use force: true",
          );
        }
      }

      if (options.action === "quarantine" && slot) {
        if (lease.state !== "quarantined") {
          const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === lease.leaseId);
          state.leases[leaseIndex] = transitionLease(lease, {
            type: "QUARANTINE",
            reason: "repair quarantine",
          })!;
          if (slot.state !== "quarantined") {
            const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
            state.slots[slotIndex] = transitionSlot(slot, { type: "QUARANTINE" })!;
          }
        }
        await savePoolState(this.poolDir, state);
        return;
      }

      if (options.action === "resume-cleanup") {
        if (!lease.pendingCleanup) {
          throw new RepairNotAvailableError("resume-cleanup requires pendingCleanup");
        }
      }
    });

    if (options.action === "resume-cleanup") {
      const lease = await this.inspect(options.leaseId);
      if (lease?.pendingCleanup) {
        return this.release(options.leaseId, lease.pendingCleanup);
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

  async inspect(leaseId: string): Promise<GroveLease | null> {
    let lease: GroveLease | null = null;
    await withStateLock(this.poolDir, async () => {
      const state = await loadPoolState(this.poolDir, this.config.repoRoot);
      lease = await inspectLeaseRecord(state, leaseId);
    });
    return lease;
  }

  async list(options?: { includeProcesses?: boolean }): Promise<readonly GroveLease[]> {
    let leases: GroveLease[] = [];
    await withStateLock(this.poolDir, async () => {
      const state = await loadPoolState(this.poolDir, this.config.repoRoot);
      leases = await listLeaseRecords(state, options);
    });
    return leases;
  }

  async listLeases(options?: { includeProcesses?: boolean }): Promise<GroveLease[]> {
    return [...(await this.list(options))];
  }

  async listWorktreeStatus(): Promise<WorktreeStatus[]> {
    const { listWorktrees } = await import("./queries.js");
    return listWorktrees(this.poolDir, this.config.repoRoot);
  }

  async findByPath(worktreePath: string): Promise<GroveSlot | null> {
    const state = await loadPoolState(this.poolDir, this.config.repoRoot);
    return state.slots.find((slot) => slot.path === worktreePath) ?? null;
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
