import { existsSync } from "node:fs";
import type { GroveConfig, GroveFailedPhase, GroveLeaseTarget } from "./schemas.js";
import type { AcquireLeaseOptions, GroveLease } from "./types.js";
import {
  checkoutBranch,
  checkoutDetached,
  fetchOrigin,
  getDefaultBranch,
  getHeadSha,
} from "./git/index.js";
import { withStateLock } from "./lock.js";
import {
  assertCompatibleReacquire,
  branchOwnedByOtherLease,
  buildAcquireTarget,
  buildPendingAcquire,
  finalizeBranchTarget,
} from "./target.js";
import { createPreparingLease, transitionLease, transitionSlot } from "./transitions.js";
import {
  findLease,
  findOrAllocateSlot,
  findSlot,
  loadPoolState,
  materializeSlotWorktree,
  reserveSlotOwner,
  savePoolState,
} from "./pool-state.js";
import { enrichLeaseReadOnly } from "./lease-view.js";
import {
  BranchExistsError,
  LeaseAlreadyExistsError,
  LeaseNotFoundError,
  LeaseQuarantinedError,
  RepairNotAvailableError,
} from "./errors.js";

export async function executeLeaseCheckout(
  wtPath: string,
  options: AcquireLeaseOptions,
): Promise<void> {
  if (options.mode === "branch") {
    await checkoutBranch(wtPath, options.branch, options.createBranch);
    return;
  }
  await checkoutDetached(wtPath, options.ref);
}

export async function finalizeLeaseCheckout(
  poolDir: string,
  repoRoot: string,
  leaseId: string,
  wtPath: string,
  pendingTarget: GroveLeaseTarget,
): Promise<GroveLease> {
  const headSha = await getHeadSha(wtPath);
  const finalizedTarget =
    pendingTarget.mode === "branch" ? finalizeBranchTarget(pendingTarget, headSha) : pendingTarget;

  await withStateLock(poolDir, async () => {
    const state = await loadPoolState(poolDir, repoRoot);
    const lease = findLease(state, leaseId);
    const slot = lease ? findSlot(state, lease.slotName) : undefined;
    if (!lease || !slot) return;

    const nextLease = transitionLease(lease, {
      type: "ACQUIRE_COMPLETE",
      target: finalizedTarget,
      headSha,
    });
    if (!nextLease) return;

    const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === leaseId);
    state.leases[leaseIndex] = nextLease;
    await savePoolState(poolDir, state);
  });

  const state = await loadPoolState(poolDir, repoRoot);
  const lease = findLease(state, leaseId);
  if (!lease) {
    throw new Error(`Lease ${leaseId} missing after acquire complete`);
  }
  return enrichLeaseReadOnly(lease);
}

export async function quarantineFailedAcquire(
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
    if (!lease || !slot) return;

    const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === leaseId);
    state.leases[leaseIndex] = transitionLease(lease, {
      type: "ACQUIRE_FAILED",
      reason,
      failedPhase,
    })!;

    const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
    state.slots[slotIndex] = transitionSlot(slot, { type: "QUARANTINE", reason })!;

    await savePoolState(poolDir, state);
  });
}

export async function acquireLease(
  poolDir: string,
  config: GroveConfig,
  options: AcquireLeaseOptions,
  hooks: {
    postCreate?: (path: string) => Promise<void>;
    postAcquire?: (path: string, lease: GroveLease) => Promise<void>;
  } = {},
): Promise<GroveLease> {
  const repoRoot = config.repoRoot;
  const shouldFetch = options.fetchOnAcquire !== false && config.fetchOnAcquire !== false;
  if (shouldFetch) {
    await fetchOrigin(repoRoot);
  }

  const pendingTarget = await buildAcquireTarget(options, repoRoot);
  const now = new Date().toISOString();
  const pendingAcquire = buildPendingAcquire(pendingTarget, now);

  let targetWtPath = "";
  let isNewSlot = false;
  let returningExisting = false;
  let leaseIdForCheckout = options.leaseId;

  await withStateLock(poolDir, async () => {
    const state = await loadPoolState(poolDir, repoRoot);
    const existing = findLease(state, options.leaseId);

    if (existing) {
      if (options.ifLeased === "fail") {
        throw new LeaseAlreadyExistsError(`Lease ${options.leaseId} already exists`);
      }

      if (!existsSync(existing.path)) {
        const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === options.leaseId);
        const slot = findSlot(state, existing.slotName);
        state.leases[leaseIndex] = transitionLease(existing, {
          type: "QUARANTINE",
          reason: "missing path",
        })!;
        if (slot) {
          const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
          state.slots[slotIndex] = transitionSlot(slot, {
            type: "QUARANTINE",
            reason: "missing path",
          })!;
        }
        await savePoolState(poolDir, state);
        throw new LeaseQuarantinedError(`Lease ${options.leaseId} path missing`);
      }

      await assertCompatibleReacquire(existing, options, repoRoot);

      if (existing.state === "leased") {
        const slot = findSlot(state, existing.slotName);
        if (slot) await reserveSlotOwner(slot);
        if (options.ownerId) {
          existing.ownerId = options.ownerId;
        }
        await savePoolState(poolDir, state);
        targetWtPath = existing.path;
        returningExisting = true;
        return;
      }
    }

    if (
      options.mode === "branch" &&
      branchOwnedByOtherLease(state.leases, options.branch, options.leaseId)
    ) {
      throw new BranchExistsError(`Branch ${options.branch} belongs to another active lease`);
    }

    const { slot, isNew } = await findOrAllocateSlot(state, poolDir, config);

    const reservedSlot = transitionSlot(slot, { type: "RESERVE_FOR_LEASE" }, now)!;
    const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
    state.slots[slotIndex] = reservedSlot;

    const preparing = createPreparingLease({
      leaseId: options.leaseId,
      slotName: reservedSlot.slotName,
      path: reservedSlot.path,
      repoRoot,
      pendingAcquire,
      ...(options.ownerId !== undefined ? { ownerId: options.ownerId } : {}),
      ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
      now,
    });
    state.leases.push(preparing);
    await reserveSlotOwner(reservedSlot);
    state.slots[slotIndex] = reservedSlot;

    await savePoolState(poolDir, state);
    targetWtPath = reservedSlot.path;
    isNewSlot = isNew;
    leaseIdForCheckout = options.leaseId;
  });

  if (returningExisting) {
    const state = await loadPoolState(poolDir, repoRoot);
    const lease = findLease(state, options.leaseId)!;
    return enrichLeaseReadOnly(lease);
  }

  let lease: GroveLease;
  if (isNewSlot) {
    try {
      const state = await loadPoolState(poolDir, repoRoot, { heal: false });
      const leaseRecord = findLease(state, leaseIdForCheckout);
      const slot = leaseRecord ? findSlot(state, leaseRecord.slotName) : undefined;
      if (!slot) {
        throw new LeaseNotFoundError(`Lease ${leaseIdForCheckout} slot not found before checkout`);
      }
      const defaultBranch = await getDefaultBranch(repoRoot);
      await materializeSlotWorktree(slot, config, defaultBranch);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "checkout failed";
      await quarantineFailedAcquire(poolDir, repoRoot, leaseIdForCheckout, reason, "checkout");
      throw err;
    }
    try {
      await hooks.postCreate?.(targetWtPath);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "postCreate hook failed";
      await quarantineFailedAcquire(poolDir, repoRoot, leaseIdForCheckout, reason, "postCreate");
      throw err;
    }
  }

  try {
    await executeLeaseCheckout(targetWtPath, options);
    lease = await finalizeLeaseCheckout(
      poolDir,
      repoRoot,
      leaseIdForCheckout,
      targetWtPath,
      pendingTarget,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "checkout failed";
    await quarantineFailedAcquire(poolDir, repoRoot, leaseIdForCheckout, reason, "checkout");
    throw err;
  }

  if (hooks.postAcquire) {
    // postAcquire runs after the lease is usable; hook failures are surfaced without quarantine.
    await hooks.postAcquire(targetWtPath, lease);
  }
  return lease;
}

export async function resumeAcquireLease(
  poolDir: string,
  config: GroveConfig,
  leaseId: string,
  hooks: {
    postCreate?: (path: string) => Promise<void>;
    postAcquire?: (path: string, lease: GroveLease) => Promise<void>;
  } = {},
): Promise<GroveLease> {
  const repoRoot = config.repoRoot;
  let wtPath = "";
  let slotName = "";
  let runPostCreate = false;
  let pendingTarget!: GroveLeaseTarget;

  await withStateLock(poolDir, async () => {
    const state = await loadPoolState(poolDir, repoRoot);
    const lease = findLease(state, leaseId);
    if (!lease) {
      throw new LeaseNotFoundError(`Lease ${leaseId} not found`);
    }
    if (!lease.pendingAcquire) {
      throw new RepairNotAvailableError("resume-acquire requires pendingAcquire");
    }
    if (lease.state !== "quarantined") {
      throw new RepairNotAvailableError(
        `resume-acquire requires quarantined lease, got ${lease.state}`,
      );
    }

    const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === leaseId);
    state.leases[leaseIndex] = transitionLease(lease, { type: "REPAIR_RESUME_ACQUIRE" })!;

    const slot = findSlot(state, lease.slotName);
    if (slot && slot.state === "quarantined") {
      const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
      state.slots[slotIndex] = transitionSlot(slot, { type: "REPAIR_RESUME_LEASE" })!;
    }

    await savePoolState(poolDir, state);
    wtPath = lease.path;
    slotName = lease.slotName;
    runPostCreate = lease.diagnostics?.failedPhase === "postCreate";
    pendingTarget = lease.pendingAcquire.target;
  });

  const options = targetToAcquireOptions(pendingTarget, leaseId);
  let lease: GroveLease;
  if (!existsSync(wtPath)) {
    try {
      const state = await loadPoolState(poolDir, repoRoot, { heal: false });
      const slot = findSlot(state, slotName);
      if (!slot) {
        throw new LeaseNotFoundError(`Lease ${leaseId} slot not found before resume-acquire`);
      }
      await materializeSlotWorktree(slot, config, await getDefaultBranch(repoRoot));
      runPostCreate = true;
    } catch (err) {
      const reason = err instanceof Error ? err.message : "resume acquire failed";
      await quarantineFailedAcquire(poolDir, repoRoot, leaseId, reason, "checkout");
      throw err;
    }
  }
  if (runPostCreate) {
    try {
      await hooks.postCreate?.(wtPath);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "postCreate hook failed";
      await quarantineFailedAcquire(poolDir, repoRoot, leaseId, reason, "postCreate");
      throw err;
    }
  }

  try {
    await executeLeaseCheckout(wtPath, options);
    lease = await finalizeLeaseCheckout(poolDir, repoRoot, leaseId, wtPath, pendingTarget);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "resume acquire failed";
    await quarantineFailedAcquire(poolDir, repoRoot, leaseId, reason, "checkout");
    throw err;
  }

  if (hooks.postAcquire) {
    // postAcquire runs after the lease is usable; hook failures are surfaced without quarantine.
    await hooks.postAcquire(wtPath, lease);
  }
  return lease;
}

function targetToAcquireOptions(target: GroveLeaseTarget, leaseId: string): AcquireLeaseOptions {
  if (target.mode === "detached") {
    return { leaseId, mode: "detached", ref: target.requestedRef };
  }
  const options: AcquireLeaseOptions = {
    leaseId,
    mode: "branch",
    branch: target.branch,
  };
  if (target.createFromRef) {
    options.createBranch = { from: target.createFromRef, ifExists: "reuse" };
  }
  return options;
}
