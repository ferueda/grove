import { fetchOrigin } from "./git/index.js";
import { withStateLock } from "./lock.js";
import { runHooks } from "./hooks.js";
import type { GroveConfig } from "./index.js";
import type {
  AcquireLeaseOptions,
  ReleaseLeaseOptions,
  ReleaseResult,
  RepairResult,
  DestroyLeaseOptions,
  RepairLeaseOptions,
  GroveLease,
} from "./types.js";
import { acquireLease } from "./lease-acquire.js";
import { destroyLease } from "./lease-destroy.js";
import { releaseLease } from "./lease-release.js";
import { repairLease } from "./lease-repair.js";
import {
  buildLeaseHookEnv,
  inspectLeaseRecord,
  listLeaseRecords,
} from "./lease-view.js";
import { loadPoolState } from "./pool-state.js";

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

  async acquire(options: AcquireLeaseOptions): Promise<GroveLease> {
    if (options.fetchOnAcquire !== false && this.config.fetchOnAcquire !== false) {
      await fetchOrigin(this.config.repoRoot);
    }

    return acquireLease(this.poolDir, this.config, options, {
      postCreate: (path) => this.runHook(this.config.hooks?.postCreate, path),
      postAcquire: (path, lease) =>
        this.runHook(this.config.hooks?.postAcquire, path, this.leaseEnv(lease)),
    });
  }

  async release(leaseId: string, options: ReleaseLeaseOptions): Promise<ReleaseResult> {
    return releaseLease(this.poolDir, this.config, leaseId, options, {
      preRelease: (path, env) => this.runHook(this.config.hooks?.preRelease, path, env),
      postRelease: (path, env) => this.runHook(this.config.hooks?.postRelease, path, env),
    });
  }

  async destroy(leaseId: string, options?: DestroyLeaseOptions): Promise<void> {
    await destroyLease(this.poolDir, this.config, leaseId, options, {
      preDestroy: (path: string, env: Record<string, string>) =>
        this.runHook(this.config.hooks?.preDestroy, path, env),
    });
  }

  async repair(
    options: RepairLeaseOptions,
  ): Promise<GroveLease | ReleaseResult | RepairResult> {
    return repairLease(this.poolDir, this.config, options, {
      postAcquire: (path, lease) =>
        this.runHook(this.config.hooks?.postAcquire, path, this.leaseEnv(lease)),
      preRelease: (path, env) => this.runHook(this.config.hooks?.preRelease, path, env),
      postRelease: (path, env) => this.runHook(this.config.hooks?.postRelease, path, env),
      preDestroy: (path, env) => this.runHook(this.config.hooks?.preDestroy, path, env),
    });
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

  private leaseEnv(lease: GroveLease): Record<string, string> {
    return buildLeaseHookEnv(lease);
  }
}
