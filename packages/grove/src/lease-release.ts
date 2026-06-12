import type {
  GroveConfig,
  GroveFailedPhase,
  GroveLeaseRecord,
  GroveSlot,
  LeaseFirstCleanupIntent,
} from "./schemas.js";
import type { ReleaseLeaseOptions, ReleaseResult } from "./types.js";
import { getDefaultBranch, resetWorktree } from "./git/index.js";
import { withStateLock } from "./lock.js";
import { isWorktreeInUse } from "./process/detect.js";
import { assertWorktreeSafeForCleanup } from "./process/cleanup-safety.js";
import {
  LeaseBusyError,
  LeaseNotFoundError,
  LeaseQuarantinedError,
  RepairNotAvailableError,
  UnsafeCleanupError,
} from "./errors.js";
import { buildLeaseHookEnv, enrichLeaseReadOnly, recordToGroveLease } from "./lease-view.js";
import { clearSlotOwner, findLease, findSlot, loadPoolState, savePoolState } from "./pool-state.js";
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

export function toLeaseFirstCleanupIntent(
  options: ReleaseLeaseOptions,
  defaultBranch: string,
): LeaseFirstCleanupIntent {
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

function assertLeaseReleasable(lease: GroveLeaseRecord): void {
  if (lease.state === "leased") {
    return;
  }
  if (lease.state === "quarantined") {
    throw new LeaseQuarantinedError(`Lease ${lease.leaseId} is quarantined`);
  }
  if (lease.state === "preparing" || lease.state === "releasing" || lease.state === "destroying") {
    throw new LeaseBusyError(`Lease ${lease.leaseId} is busy`);
  }
  throw new LeaseBusyError(`Lease ${lease.leaseId} is not releasable from ${lease.state}`);
}

async function assertFreshResetProcessSafety(
  poolDir: string,
  repoRoot: string,
  leaseId: string,
  force: boolean | undefined,
): Promise<void> {
  const state = await loadPoolState(poolDir, repoRoot);
  const lease = findLease(state, leaseId);
  const slot = lease ? findSlot(state, lease.slotName) : undefined;
  if (!lease || !slot) {
    throw new LeaseNotFoundError(`Lease ${leaseId} not found during reset safety check`);
  }
  await assertWorktreeSafeForCleanup(slot.path, slot, lease, { force });
}

function buildReleaseContext(
  lease: GroveLeaseRecord,
  slot: GroveSlot,
  pendingCleanup: LeaseFirstCleanupIntent,
  unverified: boolean,
): ReleaseContext {
  return {
    leaseId: lease.leaseId,
    slotName: slot.slotName,
    wtPath: slot.path,
    pendingCleanup,
    leaseEnvVars: buildLeaseHookEnv(
      recordToGroveLease(lease, unverified ? "unverified" : "verified"),
    ),
  };
}

async function beginRelease(
  poolDir: string,
  repoRoot: string,
  leaseId: string,
  cleanup: LeaseFirstCleanupIntent,
): Promise<ReleaseContext> {
  let context!: ReleaseContext;

  await withStateLock(poolDir, async () => {
    const state = await loadPoolState(poolDir, repoRoot);
    const lease = findLease(state, leaseId);
    if (!lease) {
      throw new LeaseNotFoundError(`Lease ${leaseId} not found`);
    }
    const slot = findSlot(state, lease.slotName);
    if (!slot) {
      throw new LeaseNotFoundError(`Lease ${leaseId} slot not found`);
    }

    assertLeaseReleasable(lease);

    const { unverified } =
      cleanup.cleanup === "reset"
        ? await assertWorktreeSafeForCleanup(slot.path, slot, lease, { force: cleanup.force })
        : await isWorktreeInUse(slot.path).then(({ unverified: u }) => ({ unverified: u }));

    const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === lease.leaseId);
    state.leases[leaseIndex] = transitionLease(lease, {
      type: "RELEASE_START",
      cleanup,
    })!;

    await savePoolState(poolDir, state);

    context = buildReleaseContext(lease, slot, cleanup, unverified);
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

    const { unverified } = await isWorktreeInUse(slot.path);
    context = buildReleaseContext(lease, slot, lease.pendingCleanup, unverified);
  });

  return context;
}

async function quarantineFailedRelease(
  poolDir: string,
  repoRoot: string,
  leaseId: string,
  reason: string,
  failedPhase: GroveFailedPhase,
): Promise<void> {
  await withStateLock(poolDir, async () => {
    const state = await loadPoolState(poolDir, repoRoot);
    const lease = findLease(state, leaseId);
    const slot = lease ? findSlot(state, lease.slotName) : undefined;
    if (!lease || !slot) {
      throw new LeaseNotFoundError(`Lease ${leaseId} missing during failed-release quarantine`);
    }

    const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === lease.leaseId);
    state.leases[leaseIndex] = transitionLease(lease, {
      type: "RELEASE_FAILED",
      reason,
      failedPhase,
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
  let preservedLease: GroveLeaseRecord | undefined;
  let quarantinedLease: GroveLeaseRecord | undefined;
  let releasedResult: Extract<ReleaseResult, { status: "released" }> | undefined;

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
      preservedLease = state.leases[leaseIndex]!;
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
      releasedResult = {
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
    quarantinedLease = state.leases[leaseIndex]!;
  });

  if (releasedResult) {
    return releasedResult;
  }
  if (preservedLease) {
    return {
      status: "preserved",
      leaseId: preservedLease.leaseId,
      lease: await enrichLeaseReadOnly(preservedLease),
    };
  }
  if (quarantinedLease) {
    return {
      status: "quarantined",
      leaseId: quarantinedLease.leaseId,
      lease: await enrichLeaseReadOnly(quarantinedLease),
    };
  }
  throw new LeaseNotFoundError(`Lease ${context.leaseId} missing during finalize`);
}

async function completeRelease(
  poolDir: string,
  repoRoot: string,
  context: ReleaseContext,
  hooks: ReleaseHooks = {},
): Promise<ReleaseResult> {
  try {
    await hooks.preRelease?.(context.wtPath, context.leaseEnvVars);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : "preRelease hook failed";
    await quarantineFailedRelease(poolDir, repoRoot, context.leaseId, reason, "preRelease");
    throw err;
  }

  if (context.pendingCleanup.cleanup === "reset") {
    await assertFreshResetProcessSafety(
      poolDir,
      repoRoot,
      context.leaseId,
      context.pendingCleanup.force,
    );
    try {
      await resetWorktree(
        context.wtPath,
        context.pendingCleanup.resetTo,
        context.pendingCleanup.cleanIgnored === undefined
          ? undefined
          : { cleanIgnored: context.pendingCleanup.cleanIgnored },
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : "reset failed";
      await quarantineFailedRelease(poolDir, repoRoot, context.leaseId, reason, "reset");
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
  leaseId: string,
  options: ReleaseLeaseOptions,
  hooks: ReleaseHooks = {},
): Promise<ReleaseResult> {
  const defaultBranch =
    options.cleanup === "reset" && options.resetTo === undefined
      ? await getDefaultBranch(config.repoRoot)
      : "";
  const cleanup = toLeaseFirstCleanupIntent(options, defaultBranch);
  const context = await beginRelease(poolDir, config.repoRoot, leaseId, cleanup);
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
