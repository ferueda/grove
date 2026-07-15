import { basename, dirname, normalize } from "node:path";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { GroveConfig, GroveLeaseRecord, GroveSlot } from "./schemas.js";
import type { DestroyLeaseOptions } from "./types.js";
import { removeWorktreeIfRegistered } from "./git/index.js";
import { withStateLock } from "./lock.js";
import { assertPathWithinPool } from "./path-boundary.js";
import { isWorktreeInUse } from "./process/detect.js";
import { assertWorktreeSafeForCleanup } from "./process/cleanup-safety.js";
import {
  InvalidInputError,
  LeaseBusyError,
  LeaseNotFoundError,
  PathOutsidePoolError,
} from "./errors.js";
import { buildLeaseHookEnv, recordToGroveLease } from "./lease-view.js";
import {
  findLease,
  findSlot,
  loadPoolState,
  reserveSlotOwner,
  savePoolState,
} from "./pool-state.js";
import { transitionLease, transitionSlot } from "./transitions.js";

const DESTROY_UNSAFE_MESSAGE = (path: string) =>
  `worktree ${path} is in use or unverified. Use --force to override`;

type DestroyHooks = {
  preDestroy?: (path: string, env: Record<string, string>) => Promise<void>;
};

type DestroyContext = {
  leaseId: string;
  slotName: string;
  wtPath: string;
  leaseEnvVars: Record<string, string>;
  force: boolean | undefined;
};

function assertDeleteBranchNotRequested(options?: DestroyLeaseOptions): void {
  if (options?.deleteBranch) {
    throw new InvalidInputError("deleteBranch is not supported in lease-first destroy MVP");
  }
}

function destroySlotDirectory(poolDir: string, wtPath: string, slotName: string): string {
  const normalizedPool = normalize(poolDir);
  const slotDir = dirname(normalize(wtPath));
  if (
    slotDir === normalizedPool ||
    dirname(slotDir) !== normalizedPool ||
    basename(slotDir) !== slotName
  ) {
    throw new PathOutsidePoolError("Worktree is not inside its owned pool slot directory");
  }
  return slotDir;
}

function assertLeaseDestroyable(
  lease: { leaseId: string; state: string },
  resuming: boolean,
): void {
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

async function beginDestroy(
  poolDir: string,
  config: GroveConfig,
  leaseId: string,
  options?: DestroyLeaseOptions,
): Promise<DestroyContext> {
  assertDeleteBranchNotRequested(options);

  let context!: DestroyContext;

  await withStateLock(poolDir, async () => {
    const state = await loadPoolState(poolDir, config.repoRoot);
    const lease = findLease(state, leaseId);
    if (!lease) {
      throw new LeaseNotFoundError(`Lease ${leaseId} not found`);
    }
    const slot = findSlot(state, lease.slotName);
    if (!slot) {
      throw new LeaseNotFoundError(`Lease ${leaseId} slot not found`);
    }
    const resuming = lease.state === "destroying" && slot.state === "destroying";

    assertLeaseDestroyable(lease, resuming);

    await assertWorktreeSafeForCleanup(slot.path, slot, lease, {
      force: options?.force,
      message: DESTROY_UNSAFE_MESSAGE(slot.path),
    });

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
      force: options?.force,
    };
  });

  return context;
}

async function loadDestroyRemovalTarget(
  poolDir: string,
  repoRoot: string,
  leaseId: string,
  slotName: string,
  expectedPath: string,
): Promise<{ lease: GroveLeaseRecord; slot: GroveSlot; wtPath: string }> {
  const state = await loadPoolState(poolDir, repoRoot);
  const lease = findLease(state, leaseId);
  const slot = findSlot(state, slotName);
  if (!lease || !slot) {
    throw new LeaseNotFoundError(`Lease ${leaseId} not found during destroy removal`);
  }
  if (slot.path !== expectedPath) {
    throw new InvalidInputError(
      `destroy path changed during operation: expected ${expectedPath}, got ${slot.path}`,
    );
  }
  return { lease, slot, wtPath: slot.path };
}

async function loadValidatedDestroyTarget(
  poolDir: string,
  repoRoot: string,
  context: DestroyContext,
): Promise<{ lease: GroveLeaseRecord; slot: GroveSlot; wtPath: string; slotDir: string }> {
  const target = await loadDestroyRemovalTarget(
    poolDir,
    repoRoot,
    context.leaseId,
    context.slotName,
    context.wtPath,
  );
  await assertPathWithinPool(poolDir, target.wtPath);
  const slotDir = destroySlotDirectory(poolDir, target.wtPath, target.slot.slotName);
  return { ...target, slotDir };
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
  return Boolean(slot?.state === "destroying" && (!lease || lease.state === "destroying"));
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
  try {
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

    const beforeHook = await loadValidatedDestroyTarget(poolDir, config.repoRoot, context);
    await assertWorktreeSafeForCleanup(beforeHook.slotDir, beforeHook.slot, beforeHook.lease, {
      force: context.force,
      ignoreOwnerReservation: true,
      message: DESTROY_UNSAFE_MESSAGE(beforeHook.slotDir),
    });

    if (existsSync(beforeHook.wtPath)) {
      await hooks.preDestroy?.(beforeHook.wtPath, context.leaseEnvVars);
    }

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

    const { lease, slot, wtPath, slotDir } = await loadValidatedDestroyTarget(
      poolDir,
      config.repoRoot,
      context,
    );

    await assertWorktreeSafeForCleanup(slotDir, slot, lease, {
      force: context.force,
      ignoreOwnerReservation: true,
      message: DESTROY_UNSAFE_MESSAGE(slotDir),
    });

    await removeWorktreeIfRegistered(config.repoRoot, wtPath);
    await rm(slotDir, { recursive: true, force: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "destroy failed";
    await quarantineFailedDestroy(poolDir, config.repoRoot, context.leaseId, reason);
    throw err;
  }

  await finalizeDestroy(poolDir, config.repoRoot, context);
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
