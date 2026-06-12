import { dirname } from "node:path";
import { rm } from "node:fs/promises";
import type { GroveConfig } from "./schemas.js";
import type { DestroyLeaseOptions } from "./types.js";
import { deleteBranch, removeWorktree } from "./git/index.js";
import { withStateLock } from "./lock.js";
import { assertPathWithinPool } from "./path-boundary.js";
import { isWorktreeInUse } from "./process/detect.js";
import { assertWorktreeSafeForCleanup } from "./process/cleanup-safety.js";
import {
  BranchDeleteFailedError,
  LeaseBusyError,
  LeaseNotFoundError,
  UnsafeCleanupError,
  WorktreeNotManagedError,
} from "./errors.js";
import { buildLeaseHookEnv, recordToGroveLease } from "./lease-view.js";
import {
  findLease,
  findLeaseByIdOrPath,
  findSlot,
  findSlotByPath,
  loadPoolState,
  reserveSlotOwner,
  savePoolState,
} from "./pool-state.js";
import { transitionLease, transitionSlot } from "./transitions.js";

type DestroyHooks = {
  preDestroy?: (path: string, env: Record<string, string>) => Promise<void>;
};

type DestroyContext = {
  leaseId: string;
  slotName: string;
  wtPath: string;
  leaseEnvVars: Record<string, string>;
  branchToDelete?: string | undefined;
  force: boolean | undefined;
};

function assertLeaseDestroyable(lease: { leaseId: string; state: string }, resuming: boolean): void {
  if (resuming) {
    return;
  }
  if (lease.state === "leased" || lease.state === "quarantined") {
    return;
  }
  if (lease.state === "destroying") {
    return;
  }
  throw new LeaseBusyError(`Lease ${lease.leaseId} is busy`);
}

async function resolveBranchToDelete(
  config: GroveConfig,
  lease: NonNullable<ReturnType<typeof findLeaseByIdOrPath>>["lease"],
  options?: DestroyLeaseOptions,
): Promise<string | undefined> {
  if (!options?.deleteBranch || lease.target?.mode !== "branch") {
    return undefined;
  }

  const branch = lease.target.branch;
  const safePrefixes = config.safeDeleteBranchPrefixes || [];
  if (!safePrefixes.some((prefix) => branch.startsWith(prefix))) {
    throw new UnsafeCleanupError(`Branch ${branch} does not match safe-delete prefixes`);
  }
  return branch;
}

async function beginDestroy(
  poolDir: string,
  config: GroveConfig,
  leaseId: string,
  options?: DestroyLeaseOptions,
): Promise<DestroyContext> {
  let context!: DestroyContext;

  await withStateLock(poolDir, async () => {
    const state = await loadPoolState(poolDir, config.repoRoot);
    const resolved = findLeaseByIdOrPath(state, leaseId);
    if (!resolved) {
      throw new LeaseNotFoundError(`Lease ${leaseId} not found`);
    }

    const { lease, slot } = resolved;
    const resuming = lease.state === "destroying" && slot.state === "destroying";

    assertLeaseDestroyable(lease, resuming);

    await assertWorktreeSafeForCleanup(slot.path, slot, lease, {
      force: options?.force,
      message: `worktree ${slot.path} is in use or unverified. Use --force to override`,
    });

    const branchToDelete = await resolveBranchToDelete(config, lease, options);

    if (!resuming) {
      const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === lease.leaseId);
      state.leases[leaseIndex] = transitionLease(lease, { type: "DESTROY_START" })!;

      const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
      state.slots[slotIndex] = transitionSlot(slot, { type: "DESTROY_START" })!;
    }

    const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
    await reserveSlotOwner(state.slots[slotIndex]!);
    const { unverified } = await isWorktreeInUse(slot.path);

    await savePoolState(poolDir, state);

    context = {
      leaseId: lease.leaseId,
      slotName: slot.slotName,
      wtPath: slot.path,
      leaseEnvVars: buildLeaseHookEnv(
        recordToGroveLease(lease, unverified ? "unverified" : "verified"),
      ),
      branchToDelete,
      force: options?.force,
    };
  });

  return context;
}

async function assertFreshDestroyProcessSafety(
  poolDir: string,
  repoRoot: string,
  leaseId: string,
  force: boolean | undefined,
): Promise<void> {
  const state = await loadPoolState(poolDir, repoRoot);
  const lease = findLease(state, leaseId);
  const slot = lease ? findSlot(state, lease.slotName) : undefined;
  if (!lease || !slot) {
    throw new LeaseNotFoundError(`Lease ${leaseId} not found during destroy safety check`);
  }

  await assertWorktreeSafeForCleanup(slot.path, slot, lease, {
    force,
    ignoreOwnerReservation: true,
    message: `worktree ${slot.path} is in use or unverified. Use --force to override`,
  });
}

async function assertDestroyStillPending(
  poolDir: string,
  repoRoot: string,
  leaseId: string,
  slotName: string,
): Promise<boolean> {
  const state = await loadPoolState(poolDir, repoRoot);
  const lease = findLease(state, leaseId);
  const slot = findSlot(state, slotName);
  return Boolean(
    slot?.state === "destroying" && (!lease || lease.state === "destroying"),
  );
}

async function quarantineFailedDestroy(
  poolDir: string,
  repoRoot: string,
  leaseId: string,
  reason: string,
): Promise<void> {
  await withStateLock(poolDir, async () => {
    const state = await loadPoolState(poolDir, repoRoot, { heal: false });
    const lease = findLease(state, leaseId);
    const slot = lease ? findSlot(state, lease.slotName) : undefined;
    if (!lease || !slot) {
      return;
    }

    const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === lease.leaseId);
    state.leases[leaseIndex] = transitionLease(lease, {
      type: "DESTROY_FAILED",
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

async function finalizeDestroy(
  poolDir: string,
  repoRoot: string,
  context: DestroyContext,
): Promise<void> {
  await withStateLock(poolDir, async () => {
    const state = await loadPoolState(poolDir, repoRoot, { heal: false });
    const lease = findLease(state, context.leaseId);
    const slot = findSlot(state, context.slotName);
    if (!lease || !slot || slot.state !== "destroying") {
      return;
    }

    const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === lease.leaseId);
    const removedLease = transitionLease(lease, { type: "DESTROY_COMPLETE" });
    if (removedLease !== null) {
      throw new Error("Expected lease removal after DESTROY_COMPLETE");
    }
    state.leases.splice(leaseIndex, 1);

    const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
    const removedSlot = transitionSlot(slot, { type: "DESTROY_COMPLETE" });
    if (removedSlot !== null) {
      throw new Error("Expected slot removal after DESTROY_COMPLETE");
    }
    state.slots.splice(slotIndex, 1);

    await savePoolState(poolDir, state);
  });
}

async function completeDestroy(
  poolDir: string,
  config: GroveConfig,
  context: DestroyContext,
  hooks: DestroyHooks = {},
): Promise<void> {
  await hooks.preDestroy?.(context.wtPath, context.leaseEnvVars);

  if (
    !(await assertDestroyStillPending(
      poolDir,
      config.repoRoot,
      context.leaseId,
      context.slotName,
    ))
  ) {
    return;
  }

  await assertFreshDestroyProcessSafety(poolDir, config.repoRoot, context.leaseId, context.force);

  let branchDeleteError: Error | undefined;
  try {
    await assertPathWithinPool(poolDir, context.wtPath);
    await removeWorktree(config.repoRoot, context.wtPath);
    await rm(dirname(context.wtPath), { recursive: true, force: true });

    if (context.branchToDelete) {
      try {
        await deleteBranch(config.repoRoot, context.branchToDelete, context.force);
      } catch (err) {
        branchDeleteError = err instanceof Error ? err : new Error("branch delete failed");
      }
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : "destroy failed";
    await quarantineFailedDestroy(poolDir, config.repoRoot, context.leaseId, reason);
    throw err;
  }

  await finalizeDestroy(poolDir, config.repoRoot, context);

  if (branchDeleteError) {
    throw new BranchDeleteFailedError(`Branch deletion failed: ${branchDeleteError.message}`);
  }
}

export async function destroyLease(
  poolDir: string,
  config: GroveConfig,
  leaseId: string,
  options?: DestroyLeaseOptions,
  hooks: DestroyHooks = {},
): Promise<void> {
  const context = await beginDestroy(poolDir, config, leaseId, options);
  await completeDestroy(poolDir, config, context, hooks);
}

type EphemeralDestroyContext = {
  slotName: string;
  wtPath: string;
  force: boolean | undefined;
};

async function beginEphemeralDestroy(
  poolDir: string,
  repoRoot: string,
  slotPath: string,
  options?: DestroyLeaseOptions,
): Promise<EphemeralDestroyContext> {
  let context!: EphemeralDestroyContext;

  await withStateLock(poolDir, async () => {
    const state = await loadPoolState(poolDir, repoRoot);
    const slot = findSlotByPath(state, slotPath);
    if (!slot) {
      throw new WorktreeNotManagedError(`worktree ${slotPath} is not managed by grove`);
    }

    const resuming = slot.state === "destroying";
    await assertWorktreeSafeForCleanup(slot.path, slot, undefined, {
      force: options?.force,
      message: `worktree ${slot.path} is in use or unverified. Use --force to override`,
    });

    if (!resuming) {
      const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
      state.slots[slotIndex] = transitionSlot(slot, { type: "DESTROY_START" })!;
    }

    const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
    await reserveSlotOwner(state.slots[slotIndex]!);
    await savePoolState(poolDir, state);

    context = {
      slotName: slot.slotName,
      wtPath: slot.path,
      force: options?.force,
    };
  });

  return context;
}

async function finalizeEphemeralDestroy(
  poolDir: string,
  repoRoot: string,
  context: EphemeralDestroyContext,
): Promise<void> {
  await withStateLock(poolDir, async () => {
    const state = await loadPoolState(poolDir, repoRoot, { heal: false });
    const slot = findSlot(state, context.slotName);
    if (!slot || slot.state !== "destroying") {
      return;
    }

    const slotIndex = state.slots.findIndex((entry) => entry.slotName === context.slotName);
    const removedSlot = transitionSlot(slot, { type: "DESTROY_COMPLETE" });
    if (removedSlot !== null) {
      throw new Error("Expected slot removal after DESTROY_COMPLETE");
    }
    state.slots.splice(slotIndex, 1);
    await savePoolState(poolDir, state);
  });
}

async function completeEphemeralDestroy(
  poolDir: string,
  config: GroveConfig,
  context: EphemeralDestroyContext,
  hooks: DestroyHooks = {},
): Promise<void> {
  await hooks.preDestroy?.(context.wtPath, {});

  const state = await loadPoolState(poolDir, config.repoRoot);
  const slot = findSlot(state, context.slotName);
  if (!slot || slot.state !== "destroying") {
    return;
  }

  await assertWorktreeSafeForCleanup(slot.path, slot, undefined, {
    force: context.force,
    ignoreOwnerReservation: true,
    message: `worktree ${slot.path} is in use or unverified. Use --force to override`,
  });
  try {
    await assertPathWithinPool(poolDir, context.wtPath);
    await removeWorktree(config.repoRoot, context.wtPath);
    await rm(dirname(context.wtPath), { recursive: true, force: true });
  } catch (err) {
    await withStateLock(poolDir, async () => {
      const locked = await loadPoolState(poolDir, config.repoRoot, { heal: false });
      const lockedSlot = findSlot(locked, context.slotName);
      if (lockedSlot && lockedSlot.state !== "quarantined") {
        const slotIndex = locked.slots.findIndex((entry) => entry.slotName === lockedSlot.slotName);
        locked.slots[slotIndex] = transitionSlot(lockedSlot, {
          type: "QUARANTINE",
          reason: err instanceof Error ? err.message : "destroy failed",
        })!;
        await savePoolState(poolDir, locked);
      }
    });
    throw err;
  }

  await finalizeEphemeralDestroy(poolDir, config.repoRoot, context);
}

export async function destroyEphemeralSlot(
  poolDir: string,
  config: GroveConfig,
  slotPath: string,
  options?: DestroyLeaseOptions,
  hooks: DestroyHooks = {},
): Promise<void> {
  const context = await beginEphemeralDestroy(poolDir, config.repoRoot, slotPath, options);
  await completeEphemeralDestroy(poolDir, config, context, hooks);
}
