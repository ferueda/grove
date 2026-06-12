import type {
  GroveLeaseRecord,
  GroveLeaseTarget,
  GroveSlot,
  LeaseFirstCleanupIntent,
  LeaseFirstGroveState,
  PendingAcquire,
} from "./schemas.js";
import { InvalidGroveStateError, InvalidTransitionError, RepairNotAvailableError } from "./errors.js";

export type LeaseEvent =
  | { type: "ACQUIRE_COMPLETE"; target: GroveLeaseTarget; headSha: string }
  | { type: "ACQUIRE_FAILED"; reason: string }
  | { type: "RELEASE_START"; cleanup: LeaseFirstCleanupIntent }
  | { type: "RELEASE_PRESERVE_COMPLETE" }
  | { type: "RELEASE_RESET_COMPLETE" }
  | { type: "RELEASE_FAILED"; reason: string }
  | { type: "QUARANTINE"; reason: string }
  | { type: "DESTROY_START" }
  | { type: "DESTROY_COMPLETE" }
  | { type: "DESTROY_FAILED"; reason: string }
  | { type: "REPAIR_RESUME_ACQUIRE" }
  | { type: "REPAIR_RESUME_CLEANUP" };

export type SlotEvent =
  | { type: "RESERVE_FOR_LEASE" }
  | { type: "RELEASE_TO_POOL" }
  | { type: "QUARANTINE"; reason?: string }
  | { type: "DESTROY_START" }
  | { type: "DESTROY_COMPLETE" }
  | { type: "REPAIR_RESUME_LEASE" };

function quarantineDiagnostics(
  lease: GroveLeaseRecord,
  reason: string,
): GroveLeaseRecord["diagnostics"] {
  return { ...lease.diagnostics, quarantineReason: reason };
}

export function transitionLease(
  lease: GroveLeaseRecord,
  event: LeaseEvent,
  now: string = new Date().toISOString(),
): GroveLeaseRecord | null {
  const base = { ...lease, updatedAt: now };

  switch (event.type) {
    case "ACQUIRE_COMPLETE": {
      if (lease.state !== "preparing") {
        throw new InvalidTransitionError(
          `ACQUIRE_COMPLETE invalid from lease state ${lease.state}`,
        );
      }
      return {
        ...base,
        state: "leased",
        target: event.target,
        acquiredHeadSha: event.headSha,
        currentHeadSha: event.headSha,
        pendingAcquire: undefined,
      };
    }
    case "ACQUIRE_FAILED": {
      if (lease.state !== "preparing") {
        throw new InvalidTransitionError(
          `ACQUIRE_FAILED invalid from lease state ${lease.state}`,
        );
      }
      return {
        ...base,
        state: "quarantined",
        diagnostics: quarantineDiagnostics(lease, event.reason),
      };
    }
    case "RELEASE_START": {
      if (lease.state !== "leased") {
        throw new InvalidTransitionError(
          `RELEASE_START invalid from lease state ${lease.state}`,
        );
      }
      return {
        ...base,
        state: "releasing",
        pendingCleanup: event.cleanup,
      };
    }
    case "RELEASE_PRESERVE_COMPLETE": {
      if (lease.state !== "releasing") {
        throw new InvalidTransitionError(
          `RELEASE_PRESERVE_COMPLETE invalid from lease state ${lease.state}`,
        );
      }
      if (lease.pendingCleanup?.cleanup !== "preserve") {
        throw new InvalidTransitionError(
          "RELEASE_PRESERVE_COMPLETE requires preserve pendingCleanup",
        );
      }
      return {
        ...base,
        state: "leased",
        ownerId: undefined,
        pendingCleanup: undefined,
      };
    }
    case "RELEASE_RESET_COMPLETE": {
      if (lease.state !== "releasing") {
        throw new InvalidTransitionError(
          `RELEASE_RESET_COMPLETE invalid from lease state ${lease.state}`,
        );
      }
      if (lease.pendingCleanup?.cleanup !== "reset") {
        throw new InvalidTransitionError(
          "RELEASE_RESET_COMPLETE requires reset pendingCleanup",
        );
      }
      return null;
    }
    case "RELEASE_FAILED": {
      if (lease.state !== "releasing") {
        throw new InvalidTransitionError(
          `RELEASE_FAILED invalid from lease state ${lease.state}`,
        );
      }
      return {
        ...base,
        state: "quarantined",
        diagnostics: quarantineDiagnostics(lease, event.reason),
      };
    }
    case "QUARANTINE": {
      if (
        lease.state !== "leased" &&
        lease.state !== "preparing" &&
        lease.state !== "releasing" &&
        lease.state !== "destroying"
      ) {
        throw new InvalidTransitionError(`QUARANTINE invalid from lease state ${lease.state}`);
      }
      return {
        ...base,
        state: "quarantined",
        ownerId: undefined,
        pendingCleanup: undefined,
        diagnostics: quarantineDiagnostics(lease, event.reason),
      };
    }
    case "DESTROY_START": {
      if (lease.state !== "leased" && lease.state !== "quarantined") {
        throw new InvalidTransitionError(
          `DESTROY_START invalid from lease state ${lease.state}`,
        );
      }
      return { ...base, state: "destroying" };
    }
    case "DESTROY_COMPLETE": {
      if (lease.state !== "destroying") {
        throw new InvalidTransitionError(
          `DESTROY_COMPLETE invalid from lease state ${lease.state}`,
        );
      }
      return null;
    }
    case "DESTROY_FAILED": {
      if (lease.state !== "destroying") {
        throw new InvalidTransitionError(
          `DESTROY_FAILED invalid from lease state ${lease.state}`,
        );
      }
      return {
        ...base,
        state: "quarantined",
        diagnostics: quarantineDiagnostics(lease, event.reason),
      };
    }
    case "REPAIR_RESUME_ACQUIRE": {
      if (lease.state !== "quarantined") {
        throw new InvalidTransitionError(
          `REPAIR_RESUME_ACQUIRE invalid from lease state ${lease.state}`,
        );
      }
      if (!lease.pendingAcquire) {
        throw new RepairNotAvailableError("resume-acquire requires pendingAcquire");
      }
      return { ...base, state: "preparing" };
    }
    case "REPAIR_RESUME_CLEANUP": {
      if (lease.state !== "quarantined") {
        throw new InvalidTransitionError(
          `REPAIR_RESUME_CLEANUP invalid from lease state ${lease.state}`,
        );
      }
      if (!lease.pendingCleanup) {
        throw new RepairNotAvailableError("resume-cleanup requires pendingCleanup");
      }
      return { ...base, state: "releasing" };
    }
    default: {
      const _exhaustive: never = event;
      throw new InvalidTransitionError(`Unknown lease event ${(_exhaustive as LeaseEvent).type}`);
    }
  }
}

export function transitionSlot(
  slot: GroveSlot,
  event: SlotEvent,
  now: string = new Date().toISOString(),
): GroveSlot | null {
  const base = { ...slot, updatedAt: now };

  switch (event.type) {
    case "RESERVE_FOR_LEASE": {
      if (slot.state !== "available") {
        throw new InvalidTransitionError(
          `RESERVE_FOR_LEASE invalid from slot state ${slot.state}`,
        );
      }
      return { ...base, state: "leased" };
    }
    case "RELEASE_TO_POOL": {
      if (slot.state !== "leased") {
        throw new InvalidTransitionError(
          `RELEASE_TO_POOL invalid from slot state ${slot.state}`,
        );
      }
      return { ...base, state: "available" };
    }
    case "QUARANTINE": {
      if (
        slot.state !== "available" &&
        slot.state !== "leased" &&
        slot.state !== "destroying"
      ) {
        throw new InvalidTransitionError(`QUARANTINE invalid from slot state ${slot.state}`);
      }
      return {
        ...base,
        state: "quarantined",
        ownerPid: undefined,
        ownerStartedAt: undefined,
      };
    }
    case "DESTROY_START": {
      if (
        slot.state !== "available" &&
        slot.state !== "leased" &&
        slot.state !== "quarantined"
      ) {
        throw new InvalidTransitionError(
          `DESTROY_START invalid from slot state ${slot.state}`,
        );
      }
      return { ...base, state: "destroying" };
    }
    case "DESTROY_COMPLETE": {
      if (slot.state !== "destroying") {
        throw new InvalidTransitionError(
          `DESTROY_COMPLETE invalid from slot state ${slot.state}`,
        );
      }
      return null;
    }
    case "REPAIR_RESUME_LEASE": {
      if (slot.state !== "quarantined") {
        throw new InvalidTransitionError(
          `REPAIR_RESUME_LEASE invalid from slot state ${slot.state}`,
        );
      }
      return { ...base, state: "leased" };
    }
    default: {
      const _exhaustive: never = event;
      throw new InvalidTransitionError(`Unknown slot event ${(_exhaustive as SlotEvent).type}`);
    }
  }
}

export function createPreparingLease(input: {
  leaseId: string;
  slotName: string;
  path: string;
  repoRoot: string;
  pendingAcquire: PendingAcquire;
  ownerId?: string;
  metadata?: Record<string, string>;
  now?: string;
}): GroveLeaseRecord {
  const now = input.now ?? new Date().toISOString();
  return {
    leaseId: input.leaseId,
    ownerId: input.ownerId,
    slotName: input.slotName,
    path: input.path,
    repoRoot: input.repoRoot,
    state: "preparing",
    pendingAcquire: input.pendingAcquire,
    metadata: input.metadata,
    createdAt: now,
    updatedAt: now,
  };
}

export function assertJointInvariants(state: LeaseFirstGroveState): void {
  const slotNames = new Set<string>();
  for (const slot of state.slots) {
    if (slotNames.has(slot.slotName)) {
      throw new InvalidGroveStateError(`Duplicate slotName: ${slot.slotName}`);
    }
    slotNames.add(slot.slotName);
  }

  const slotByName = new Map(state.slots.map((slot) => [slot.slotName, slot]));
  const leaseIds = new Set<string>();
  const leasedSlotNames = new Set<string>();

  for (const lease of state.leases) {
    if (leaseIds.has(lease.leaseId)) {
      throw new InvalidGroveStateError(`Duplicate leaseId: ${lease.leaseId}`);
    }
    leaseIds.add(lease.leaseId);

    if (leasedSlotNames.has(lease.slotName)) {
      throw new InvalidGroveStateError(`Duplicate lease for slot: ${lease.slotName}`);
    }
    leasedSlotNames.add(lease.slotName);

    const slot = slotByName.get(lease.slotName);
    if (!slot) {
      throw new InvalidGroveStateError(
        `Lease ${lease.leaseId} references missing slot ${lease.slotName}`,
      );
    }

    if (lease.path !== slot.path) {
      throw new InvalidGroveStateError(
        `Lease ${lease.leaseId} path does not match slot ${lease.slotName}`,
      );
    }

    if (lease.state === "preparing" && !lease.pendingAcquire) {
      throw new InvalidGroveStateError(
        `Lease ${lease.leaseId} is preparing without pendingAcquire`,
      );
    }

    if (lease.state === "leased") {
      if (!lease.target) {
        throw new InvalidGroveStateError(`Lease ${lease.leaseId} is leased without target`);
      }
      if (!lease.acquiredHeadSha || !lease.currentHeadSha) {
        throw new InvalidGroveStateError(
          `Lease ${lease.leaseId} is leased without acquiredHeadSha and currentHeadSha`,
        );
      }
    }

    if (lease.state === "releasing" && !lease.pendingCleanup) {
      throw new InvalidGroveStateError(
        `Lease ${lease.leaseId} is releasing without pendingCleanup`,
      );
    }

    if (slot.state === "available") {
      throw new InvalidGroveStateError(
        `Slot ${slot.slotName} is available while lease ${lease.leaseId} exists`,
      );
    }

    if (lease.state === "quarantined" && slot.state !== "quarantined") {
      throw new InvalidGroveStateError(
        `Quarantined lease ${lease.leaseId} requires quarantined slot ${slot.slotName}`,
      );
    }

    if (lease.state === "destroying" && slot.state !== "destroying") {
      throw new InvalidGroveStateError(
        `Destroying lease ${lease.leaseId} requires destroying slot ${slot.slotName}`,
      );
    }

    if (
      (lease.state === "preparing" || lease.state === "leased" || lease.state === "releasing") &&
      slot.state !== "leased"
    ) {
      throw new InvalidGroveStateError(
        `Lease ${lease.leaseId} in ${lease.state} requires leased slot ${slot.slotName}`,
      );
    }
  }

  for (const slot of state.slots) {
    const hasLease = leasedSlotNames.has(slot.slotName);
    if (!hasLease && slot.state === "leased") {
      throw new InvalidGroveStateError(`Slot ${slot.slotName} is leased without a lease record`);
    }
  }
}
