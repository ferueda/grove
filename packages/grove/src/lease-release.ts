import type { GroveConfig, LeaseFirstCleanupIntent } from "./schemas.js";
import type { ReleaseLeaseOptions, ReleaseResult } from "./types.js";
import { getDefaultBranch, resetWorktree } from "./git/index.js";
import { withStateLock } from "./lock.js";
import { isWorktreeInUse, ownerAlive } from "./process/detect.js";
import {
  LeaseNotFoundError,
  RepairNotAvailableError,
  UnsafeCleanupError,
} from "./errors.js";
import { enrichLeaseReadOnly, recordToGroveLease } from "./lease-view.js";
import {
  clearSlotOwner,
  findLease,
  findSlot,
  loadPoolState,
  savePoolState,
  slotToWorktreeEntry,
} from "./pool-state.js";
import { transitionLease, transitionSlot } from "./transitions.js";

type ReleaseHooks = {
  preRelease?: (path: string, env: Record<string, string>) => Promise<void>;
  postRelease?: (path: string, env: Record<string, string>) => Promise<void>;
};

type ReleaseContext = {
  leaseId: string;
  slotName: string;
  wtPath: string;
  pendingCleanup: LeaseFirstCleanupIntent;
  leaseEnvVars: Record<string, string>;
};

export async function toLeaseFirstCleanupIntent(
  options: ReleaseLeaseOptions,
  defaultBranch: string,
): Promise<LeaseFirstCleanupIntent> {
  if (options.cleanup === "reset") {
    return {
      cleanup: "reset",
      resetTo: options.resetTo ?? defaultBranch,
      ...(options.force !== undefined ? { force: options.force } : {}),
      ...(options.cleanIgnored !== undefined ? { cleanIgnored: options.cleanIgnored } : {}),
    };
  }
  return options;
}

async function assertResetProcessSafety(
  slotPath: string,
  slot: Parameters<typeof slotToWorktreeEntry>[0],
  lease: Parameters<typeof slotToWorktreeEntry>[1],
  force: boolean | undefined,
): Promise<void> {
  if (force) return;

  const { inUse, unverified } = await isWorktreeInUse(slotPath);
  const alive = await ownerAlive(slotToWorktreeEntry(slot, lease));
  if (inUse || alive || unverified) {
    throw new UnsafeCleanupError(
      "Unsafe cleanup: active processes or unverified safety. Use force: true.",
    );
  }
}

async function beginRelease(
  poolDir: string,
  repoRoot: string,
  leaseIdOrPath: string,
  cleanup: LeaseFirstCleanupIntent,
): Promise<ReleaseContext> {
  let context!: ReleaseContext;

  await withStateLock(poolDir, async () => {
    const state = await loadPoolState(poolDir, repoRoot);
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

    if (lease.state !== "leased") {
      throw new LeaseNotFoundError(`Lease ${lease.leaseId} is not releasable from ${lease.state}`);
    }

    if (cleanup.cleanup === "reset") {
      await assertResetProcessSafety(slot.path, slot, lease, cleanup.force);
    }

    const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === lease.leaseId);
    state.leases[leaseIndex] = transitionLease(lease, {
      type: "RELEASE_START",
      cleanup,
    })!;

    await savePoolState(poolDir, state);

    const { inUse, unverified } = await isWorktreeInUse(slot.path);
    context = {
      leaseId: lease.leaseId,
      slotName: slot.slotName,
      wtPath: slot.path,
      pendingCleanup: cleanup,
      leaseEnvVars: leaseEnv(recordToGroveLease(lease, unverified ? "unverified" : "verified")),
    };
    void inUse;
  });

  return context;
}

async function loadReleasingContext(
  poolDir: string,
  repoRoot: string,
  leaseId: string,
): Promise<ReleaseContext> {
  let context!: ReleaseContext;

  await withStateLock(poolDir, async () => {
    const state = await loadPoolState(poolDir, repoRoot);
    const lease = findLease(state, leaseId);
    if (!lease?.pendingCleanup) {
      throw new RepairNotAvailableError("resume-cleanup requires pendingCleanup");
    }
    if (lease.state !== "releasing") {
      throw new RepairNotAvailableError(
        `resume-cleanup requires releasing lease, got ${lease.state}`,
      );
    }

    const slot = findSlot(state, lease.slotName);
    if (!slot) {
      throw new LeaseNotFoundError(`Lease ${leaseId} slot not found`);
    }

    if (lease.pendingCleanup.cleanup === "reset") {
      await assertResetProcessSafety(slot.path, slot, lease, lease.pendingCleanup.force);
    }

    const { inUse, unverified } = await isWorktreeInUse(slot.path);
    context = {
      leaseId: lease.leaseId,
      slotName: slot.slotName,
      wtPath: slot.path,
      pendingCleanup: lease.pendingCleanup,
      leaseEnvVars: leaseEnv(recordToGroveLease(lease, unverified ? "unverified" : "verified")),
    };
    void inUse;
  });

  return context;
}

function leaseEnv(lease: ReturnType<typeof recordToGroveLease>): Record<string, string> {
  return {
    GROVE_LEASE_ID: lease.leaseId,
    ...(lease.ownerId ? { GROVE_OWNER_ID: lease.ownerId } : {}),
    ...(lease.branch ? { GROVE_BRANCH: lease.branch } : {}),
    ...(lease.baseRef ? { GROVE_BASE_REF: lease.baseRef } : {}),
    ...(lease.baseSha ? { GROVE_BASE_SHA: lease.baseSha } : {}),
  };
}

async function executeResetCleanup(
  wtPath: string,
  pendingCleanup: Extract<LeaseFirstCleanupIntent, { cleanup: "reset" }>,
): Promise<void> {
  await resetWorktree(
    wtPath,
    pendingCleanup.resetTo,
    pendingCleanup.cleanIgnored === undefined
      ? undefined
      : { cleanIgnored: pendingCleanup.cleanIgnored },
  );
}

async function quarantineFailedRelease(
  poolDir: string,
  repoRoot: string,
  leaseId: string,
  reason: string,
): Promise<void> {
  await withStateLock(poolDir, async () => {
    const state = await loadPoolState(poolDir, repoRoot);
    const lease = findLease(state, leaseId);
    const slot = lease ? findSlot(state, lease.slotName) : undefined;
    if (!lease || !slot) return;

    const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === lease.leaseId);
    state.leases[leaseIndex] = transitionLease(lease, {
      type: "RELEASE_FAILED",
      reason,
    })!;

    if (slot.state !== "quarantined") {
      const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
      state.slots[slotIndex] = transitionSlot(slot, {
        type: "QUARANTINE",
        reason,
      })!;
    }

    await savePoolState(poolDir, state);
  });
}

async function finalizeRelease(
  poolDir: string,
  repoRoot: string,
  context: ReleaseContext,
): Promise<ReleaseResult> {
  let result!: ReleaseResult;

  await withStateLock(poolDir, async () => {
    const state = await loadPoolState(poolDir, repoRoot);
    const lease = findLease(state, context.leaseId);
    const slot = lease ? findSlot(state, lease.slotName) : undefined;
    if (!lease || !slot) {
      throw new LeaseNotFoundError(`Lease ${context.leaseId} missing during finalize`);
    }

    await clearSlotOwner(slot);

    const cleanup = context.pendingCleanup;
    if (cleanup.cleanup === "preserve") {
      const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === lease.leaseId);
      state.leases[leaseIndex] = transitionLease(lease, { type: "RELEASE_PRESERVE_COMPLETE" })!;
      await savePoolState(poolDir, state);
      result = {
        status: "preserved",
        leaseId: lease.leaseId,
        lease: await enrichLeaseReadOnly(state.leases[leaseIndex]!),
      };
      return;
    }

    if (cleanup.cleanup === "reset") {
      const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === lease.leaseId);
      const removed = transitionLease(lease, { type: "RELEASE_RESET_COMPLETE" });
      if (removed !== null) {
        throw new Error(`Expected lease removal after RELEASE_RESET_COMPLETE`);
      }
      state.leases.splice(leaseIndex, 1);

      const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
      state.slots[slotIndex] = transitionSlot(slot, { type: "RELEASE_TO_POOL" })!;

      await savePoolState(poolDir, state);
      result = {
        status: "released",
        leaseId: context.leaseId,
        slotName: context.slotName,
        path: context.wtPath,
      };
      return;
    }

    const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === lease.leaseId);
    state.leases[leaseIndex] = transitionLease(lease, {
      type: "QUARANTINE",
      reason: "release quarantine",
    })!;

    const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
    if (slot.state !== "quarantined") {
      state.slots[slotIndex] = transitionSlot(slot, { type: "QUARANTINE" })!;
    }

    await savePoolState(poolDir, state);
    result = {
      status: "quarantined",
      leaseId: lease.leaseId,
      lease: await enrichLeaseReadOnly(state.leases[leaseIndex]!),
    };
  });

  return result;
}

async function completeRelease(
  poolDir: string,
  repoRoot: string,
  context: ReleaseContext,
  hooks: ReleaseHooks = {},
): Promise<ReleaseResult> {
  await hooks.preRelease?.(context.wtPath, context.leaseEnvVars);

  if (context.pendingCleanup.cleanup === "reset") {
    try {
      await executeResetCleanup(context.wtPath, context.pendingCleanup);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "reset failed";
      await quarantineFailedRelease(poolDir, repoRoot, context.leaseId, reason);
      throw new UnsafeCleanupError(`Cleanup failed: ${reason}`);
    }
  }

  const result = await finalizeRelease(poolDir, repoRoot, context);
  await hooks.postRelease?.(context.wtPath, context.leaseEnvVars);
  return result;
}

export async function releaseLease(
  poolDir: string,
  config: GroveConfig,
  leaseIdOrPath: string,
  options: ReleaseLeaseOptions,
  hooks: ReleaseHooks = {},
): Promise<ReleaseResult> {
  const defaultBranch = await getDefaultBranch(config.repoRoot);
  const cleanup = await toLeaseFirstCleanupIntent(options, defaultBranch);
  const context = await beginRelease(poolDir, config.repoRoot, leaseIdOrPath, cleanup);
  return completeRelease(poolDir, config.repoRoot, context, hooks);
}

export async function resumeCleanupLease(
  poolDir: string,
  config: GroveConfig,
  leaseId: string,
  hooks: ReleaseHooks = {},
): Promise<ReleaseResult> {
  await withStateLock(poolDir, async () => {
    const state = await loadPoolState(poolDir, config.repoRoot);
    const lease = findLease(state, leaseId);
    if (!lease?.pendingCleanup) {
      throw new RepairNotAvailableError("resume-cleanup requires pendingCleanup");
    }

    if (lease.state === "quarantined") {
      const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === leaseId);
      state.leases[leaseIndex] = transitionLease(lease, { type: "REPAIR_RESUME_CLEANUP" })!;

      const slot = findSlot(state, lease.slotName);
      if (slot?.state === "quarantined") {
        const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
        state.slots[slotIndex] = transitionSlot(slot, { type: "REPAIR_RESUME_LEASE" })!;
      }

      await savePoolState(poolDir, state);
      return;
    }

    if (lease.state !== "releasing") {
      throw new RepairNotAvailableError(
        `resume-cleanup requires quarantined or releasing lease, got ${lease.state}`,
      );
    }
  });

  const context = await loadReleasingContext(poolDir, config.repoRoot, leaseId);
  return completeRelease(poolDir, config.repoRoot, context, hooks);
}
