import {
  getDefaultBranch,
  resetWorktree,
  fetchOrigin,
} from "./git/index.js";
import { withStateLock } from "./lock.js";
import { reserveOwner } from "./process/detect.js";
import { assertWorktreeSafeForCleanup } from "./process/cleanup-safety.js";
import { runHooks } from "./hooks.js";
import type { GroveConfig } from "./index.js";
import type { GroveSlot } from "./schemas.js";
import {
  WorktreeDestroyingError,
  WorktreeNotManagedError,
  LeaseNotFoundError,
} from "./errors.js";
import type {
  AcquiredSlot,
  AcquireLeaseOptions,
  ReleaseLeaseOptions,
  ReleaseResult,
  DestroyLeaseOptions,
  RepairLeaseOptions,
  GroveLease,
  WorktreeStatus,
} from "./types.js";
import { acquireLease, resumeAcquireLease } from "./lease-acquire.js";
import { destroyEphemeralSlot, destroyLease, preflightDestroyAll } from "./lease-destroy.js";
import { releaseLease, resumeCleanupLease } from "./lease-release.js";
import {
  buildLeaseHookEnv,
  inspectLeaseRecord,
  listLeaseRecords,
} from "./lease-view.js";
import {
  applyLeaseSlotQuarantine,
  clearSlotOwner,
  findLease,
  findLeaseByIdOrPath,
  findOrAllocateSlot,
  findSlot,
  leaseForSlot,
  loadPoolState,
  savePoolState,
  slotToWorktreeEntry,
} from "./pool-state.js";

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
  async release(leaseIdOrPath: string, options: ReleaseLeaseOptions): Promise<ReleaseResult>;
  async release(leaseIdOrPath: string, options?: ReleaseLeaseOptions): Promise<void | ReleaseResult> {
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

    return releaseLease(this.poolDir, this.config, leaseIdOrPath, options, {
      preRelease: (path, env) => this.runHook(this.config.hooks?.preRelease, path, env),
      postRelease: (path, env) => this.runHook(this.config.hooks?.postRelease, path, env),
    });
  }

  async destroy(leaseIdOrPath: string, options?: DestroyLeaseOptions): Promise<void> {
    const state = await loadPoolState(this.poolDir, this.config.repoRoot);
    const resolved = findLeaseByIdOrPath(state, leaseIdOrPath);
    const destroyHooks = {
      preDestroy: (path: string, env: Record<string, string>) =>
        this.runHook(this.config.hooks?.preDestroy, path, env),
    };

    if (resolved?.lease) {
      await destroyLease(
        this.poolDir,
        this.config,
        resolved.lease.leaseId,
        options,
        destroyHooks,
      );
      return;
    }

    await destroyEphemeralSlot(this.poolDir, this.config, leaseIdOrPath, options, destroyHooks);
  }

  async destroyAll(options?: { force?: boolean }): Promise<void> {
    await preflightDestroyAll(this.poolDir, this.config.repoRoot, options);

    const state = await loadPoolState(this.poolDir, this.config.repoRoot);
    const leaseIds = state.leases.map((lease) => lease.leaseId);
    const ephemeralPaths = state.slots
      .filter((slot) => !leaseForSlot(state, slot.slotName))
      .map((slot) => slot.path);

    for (const leaseId of leaseIds) {
      await this.destroy(leaseId, options);
    }
    for (const path of ephemeralPaths) {
      await this.destroy(path, options);
    }
  }

  async repair(options: RepairLeaseOptions): Promise<GroveLease | ReleaseResult | void> {
    if (options.action === "resume-acquire") {
      return resumeAcquireLease(this.poolDir, this.config, options.leaseId, {
        postAcquire: (path, lease) =>
          this.runHook(this.config.hooks?.postAcquire, path, this.leaseEnv(lease)),
      });
    }

    if (options.action === "resume-cleanup") {
      return resumeCleanupLease(this.poolDir, this.config, options.leaseId, {
        preRelease: (path, env) => this.runHook(this.config.hooks?.preRelease, path, env),
        postRelease: (path, env) => this.runHook(this.config.hooks?.postRelease, path, env),
      });
    }

    await withStateLock(this.poolDir, async () => {
      const state = await loadPoolState(this.poolDir, this.config.repoRoot);
      const lease = findLease(state, options.leaseId);
      if (!lease) throw new LeaseNotFoundError(`Lease ${options.leaseId} not found`);

      const slot = findSlot(state, lease.slotName);

      if (options.action === "force-destroy" && slot) {
        await assertWorktreeSafeForCleanup(slot.path, slot, lease, {
          force: options.force,
          message:
            "Cannot force-destroy: processes running or unverified. Use force: true",
        });
      }

      if (options.action === "quarantine" && slot && lease.state !== "quarantined") {
        applyLeaseSlotQuarantine(state, lease, "repair quarantine");
        await savePoolState(this.poolDir, state);
        return;
      }

    });

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

  private leaseEnv(lease: GroveLease): Record<string, string> {
    return buildLeaseHookEnv(lease);
  }
}
