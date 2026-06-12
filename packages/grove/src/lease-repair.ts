import type { GroveConfig } from "./schemas.js";
import type { DestroyLeaseOptions, GroveLease, ReleaseResult, RepairLeaseOptions, RepairResult } from "./types.js";
import { assertWorktreeSafeForCleanup } from "./process/cleanup-safety.js";
import { withStateLock } from "./lock.js";
import { LeaseNotFoundError } from "./errors.js";
import { resumeAcquireLease } from "./lease-acquire.js";
import { destroyLease } from "./lease-destroy.js";
import { resumeCleanupLease } from "./lease-release.js";
import { inspectLeaseRecord } from "./lease-view.js";
import {
  applyLeaseSlotQuarantine,
  findLease,
  findSlot,
  loadPoolState,
  savePoolState,
} from "./pool-state.js";

type RepairHooks = {
  postAcquire?: (path: string, lease: GroveLease) => Promise<void>;
  preRelease?: (path: string, env: Record<string, string>) => Promise<void>;
  postRelease?: (path: string, env: Record<string, string>) => Promise<void>;
  preDestroy?: (path: string, env: Record<string, string>) => Promise<void>;
};

async function repairQuarantine(
  poolDir: string,
  repoRoot: string,
  leaseId: string,
): Promise<RepairResult> {
  let lease!: GroveLease;

  await withStateLock(poolDir, async () => {
    const state = await loadPoolState(poolDir, repoRoot);
    const record = findLease(state, leaseId);
    if (!record) {
      throw new LeaseNotFoundError(`Lease ${leaseId} not found`);
    }

    applyLeaseSlotQuarantine(state, record, "repair quarantine");
    await savePoolState(poolDir, state);

    const inspected = await inspectLeaseRecord(state, leaseId);
    if (!inspected) {
      throw new LeaseNotFoundError(`Lease ${leaseId} not found after quarantine repair`);
    }
    lease = inspected;
  });

  return { status: "quarantined", leaseId, lease };
}

async function repairForceDestroy(
  poolDir: string,
  config: GroveConfig,
  leaseId: string,
  options: Pick<RepairLeaseOptions, "force">,
  hooks: Pick<RepairHooks, "preDestroy">,
): Promise<RepairResult> {
  await withStateLock(poolDir, async () => {
    const state = await loadPoolState(poolDir, config.repoRoot);
    const record = findLease(state, leaseId);
    if (!record) {
      throw new LeaseNotFoundError(`Lease ${leaseId} not found`);
    }

    const slot = findSlot(state, record.slotName);
    if (slot) {
      await assertWorktreeSafeForCleanup(slot.path, slot, record, {
        force: options.force,
        message:
          "Cannot force-destroy: processes running or unverified. Use force: true",
      });
    }
  });

  const destroyOptions: DestroyLeaseOptions = { force: true };
  const destroyHooks = hooks.preDestroy ? { preDestroy: hooks.preDestroy } : {};
  await destroyLease(poolDir, config, leaseId, destroyOptions, destroyHooks);

  return { status: "destroyed", leaseId };
}

export async function repairLease(
  poolDir: string,
  config: GroveConfig,
  options: RepairLeaseOptions,
  hooks: RepairHooks = {},
): Promise<GroveLease | ReleaseResult | RepairResult> {
  switch (options.action) {
    case "resume-acquire": {
      const acquireHooks = hooks.postAcquire ? { postAcquire: hooks.postAcquire } : {};
      return resumeAcquireLease(poolDir, config, options.leaseId, acquireHooks);
    }
    case "resume-cleanup": {
      const releaseHooks: {
        preRelease?: (path: string, env: Record<string, string>) => Promise<void>;
        postRelease?: (path: string, env: Record<string, string>) => Promise<void>;
      } = {};
      if (hooks.preRelease) releaseHooks.preRelease = hooks.preRelease;
      if (hooks.postRelease) releaseHooks.postRelease = hooks.postRelease;
      return resumeCleanupLease(poolDir, config, options.leaseId, releaseHooks);
    }
    case "quarantine":
      return repairQuarantine(poolDir, config.repoRoot, options.leaseId);
    case "force-destroy":
      return repairForceDestroy(poolDir, config, options.leaseId, options, hooks);
    default: {
      const _exhaustive: never = options.action;
      throw new Error(`Unknown repair action ${_exhaustive}`);
    }
  }
}
