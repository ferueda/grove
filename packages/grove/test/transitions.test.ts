import { describe, it, expect } from "vitest";
import {
  assertJointInvariants,
  createPreparingLease,
  transitionLease,
  transitionSlot,
  type LeaseEvent,
  type SlotEvent,
} from "../src/transitions.js";
import type {
  GroveLeaseRecord,
  GroveLeaseTarget,
  GroveSlot,
  LeaseFirstGroveState,
} from "../src/schemas.js";
import {
  InvalidGroveStateError,
  InvalidTransitionError,
  RepairNotAvailableError,
} from "../src/errors.js";

const NOW = "2026-06-11T00:00:00.000Z";
const TARGET: GroveLeaseTarget = {
  mode: "branch",
  branch: "agent/job-1",
  requestedRef: "origin/main",
  resolvedRefSha: "abc123",
  branchHeadShaAtAcquire: "abc123",
};

function leasedLease(overrides: Partial<GroveLeaseRecord> = {}): GroveLeaseRecord {
  return {
    leaseId: "job-1",
    slotName: "slot-1",
    path: "/pool/slot-1",
    repoRoot: "/repo",
    state: "leased",
    target: TARGET,
    acquiredHeadSha: "abc123",
    currentHeadSha: "abc123",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function leasedSlot(overrides: Partial<GroveSlot> = {}): GroveSlot {
  return {
    slotName: "slot-1",
    path: "/pool/slot-1",
    state: "leased",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function jointState(
  lease: GroveLeaseRecord,
  slot: GroveSlot = leasedSlot({ slotName: lease.slotName, path: lease.path }),
): LeaseFirstGroveState {
  return { slots: [slot], leases: [lease] };
}

describe("transitionLease", () => {
  it("preparing -> leased on ACQUIRE_COMPLETE", () => {
    const lease = createPreparingLease({
      leaseId: "job-1",
      slotName: "slot-1",
      path: "/pool/slot-1",
      repoRoot: "/repo",
      pendingAcquire: { target: TARGET, startedAt: NOW },
      now: NOW,
    });

    const next = transitionLease(
      lease,
      { type: "ACQUIRE_COMPLETE", target: TARGET, headSha: "abc123" },
      NOW,
    );

    expect(next?.state).toBe("leased");
    expect(next?.pendingAcquire).toBeUndefined();
    expect(next?.target).toEqual(TARGET);
  });

  it("preparing -> quarantined on ACQUIRE_FAILED", () => {
    const lease = createPreparingLease({
      leaseId: "job-1",
      slotName: "slot-1",
      path: "/pool/slot-1",
      repoRoot: "/repo",
      pendingAcquire: { target: TARGET, startedAt: NOW },
      now: NOW,
    });

    const next = transitionLease(lease, { type: "ACQUIRE_FAILED", reason: "checkout failed" }, NOW);
    expect(next?.state).toBe("quarantined");
    expect(next?.diagnostics?.quarantineReason).toBe("checkout failed");
  });

  it("records structured acquire failure phase", () => {
    const lease = createPreparingLease({
      leaseId: "job-1",
      slotName: "slot-1",
      path: "/pool/slot-1",
      repoRoot: "/repo",
      pendingAcquire: { target: TARGET, startedAt: NOW },
      now: NOW,
    });

    const next = transitionLease(
      lease,
      { type: "ACQUIRE_FAILED", reason: "hook failed", failedPhase: "postCreate" },
      NOW,
    );
    expect(next?.diagnostics?.failedPhase).toBe("postCreate");
  });

  it("leased -> releasing on RELEASE_START", () => {
    const next = transitionLease(
      leasedLease(),
      { type: "RELEASE_START", cleanup: { cleanup: "preserve" } },
      NOW,
    );
    expect(next?.state).toBe("releasing");
    expect(next?.pendingCleanup).toEqual({ cleanup: "preserve" });
  });

  it("releasing preserve -> leased on RELEASE_PRESERVE_COMPLETE", () => {
    const lease = leasedLease({
      state: "releasing",
      pendingCleanup: { cleanup: "preserve" },
      ownerId: "owner-1",
    });
    const next = transitionLease(lease, { type: "RELEASE_PRESERVE_COMPLETE" }, NOW);
    expect(next?.state).toBe("leased");
    expect(next?.ownerId).toBeUndefined();
    expect(next?.pendingCleanup).toBeUndefined();
  });

  it("releasing reset -> removed on RELEASE_RESET_COMPLETE", () => {
    const lease = leasedLease({
      state: "releasing",
      pendingCleanup: { cleanup: "reset", resetTo: "origin/main" },
    });
    const next = transitionLease(lease, { type: "RELEASE_RESET_COMPLETE" }, NOW);
    expect(next).toBeNull();
  });

  it("releasing -> quarantined on RELEASE_FAILED and preserves pendingCleanup", () => {
    const pendingCleanup = { cleanup: "reset" as const, resetTo: "origin/main" };
    const lease = leasedLease({
      state: "releasing",
      pendingCleanup,
    });
    const next = transitionLease(lease, { type: "RELEASE_FAILED", reason: "reset failed" }, NOW);
    expect(next?.state).toBe("quarantined");
    expect(next?.pendingCleanup).toEqual(pendingCleanup);
  });

  it("records structured release failure phase", () => {
    const pendingCleanup = { cleanup: "reset" as const, resetTo: "origin/main" };
    const lease = leasedLease({
      state: "releasing",
      pendingCleanup,
    });
    const next = transitionLease(
      lease,
      { type: "RELEASE_FAILED", reason: "reset failed", failedPhase: "reset" },
      NOW,
    );
    expect(next?.diagnostics?.failedPhase).toBe("reset");
  });

  it("quarantined after RELEASE_FAILED can resume cleanup via REPAIR_RESUME_CLEANUP", () => {
    const pendingCleanup = { cleanup: "reset" as const, resetTo: "origin/main" };
    const failed = transitionLease(
      leasedLease({ state: "releasing", pendingCleanup }),
      { type: "RELEASE_FAILED", reason: "reset failed" },
      NOW,
    );
    const resumed = transitionLease(failed!, { type: "REPAIR_RESUME_CLEANUP" }, NOW);
    expect(resumed?.state).toBe("releasing");
    expect(resumed?.pendingCleanup).toEqual(pendingCleanup);
  });

  it("leased -> destroying on DESTROY_START", () => {
    const next = transitionLease(leasedLease(), { type: "DESTROY_START" }, NOW);
    expect(next?.state).toBe("destroying");
  });

  it("destroying -> removed on DESTROY_COMPLETE", () => {
    const lease = leasedLease({ state: "destroying" });
    expect(transitionLease(lease, { type: "DESTROY_COMPLETE" }, NOW)).toBeNull();
  });

  it("destroying -> quarantined on DESTROY_FAILED", () => {
    const lease = leasedLease({ state: "destroying" });
    const next = transitionLease(lease, { type: "DESTROY_FAILED", reason: "rm failed" }, NOW);
    expect(next?.state).toBe("quarantined");
  });

  it("quarantined -> preparing on REPAIR_RESUME_ACQUIRE when pendingAcquire exists", () => {
    const lease = leasedLease({
      state: "quarantined",
      pendingAcquire: { target: TARGET, startedAt: NOW },
    });
    const next = transitionLease(
      lease,
      { type: "REPAIR_RESUME_ACQUIRE", postCreatePending: false },
      NOW,
    );
    expect(next?.state).toBe("preparing");
    expect(next?.pendingAcquire?.postCreatePending).toBe(false);
  });

  it("preparing -> preparing on REPAIR_RESUME_ACQUIRE", () => {
    const lease = createPreparingLease({
      leaseId: "job-1",
      slotName: "slot-1",
      path: "/pool/slot-1",
      repoRoot: "/repo",
      pendingAcquire: { target: TARGET, startedAt: NOW },
      now: NOW,
    });

    const next = transitionLease(
      lease,
      { type: "REPAIR_RESUME_ACQUIRE", postCreatePending: true },
      NOW,
    );
    expect(next?.state).toBe("preparing");
    expect(next?.pendingAcquire?.postCreatePending).toBe(true);
  });

  it("records completed postCreate work", () => {
    const lease = createPreparingLease({
      leaseId: "job-1",
      slotName: "slot-1",
      path: "/pool/slot-1",
      repoRoot: "/repo",
      pendingAcquire: { target: TARGET, startedAt: NOW, postCreatePending: true },
      now: NOW,
    });

    const next = transitionLease(lease, { type: "ACQUIRE_POST_CREATE_COMPLETE" }, NOW);
    expect(next?.pendingAcquire?.postCreatePending).toBe(false);
  });

  it("quarantined -> releasing on REPAIR_RESUME_CLEANUP when pendingCleanup exists", () => {
    const lease = leasedLease({
      state: "quarantined",
      pendingCleanup: { cleanup: "preserve" },
    });
    const next = transitionLease(lease, { type: "REPAIR_RESUME_CLEANUP" }, NOW);
    expect(next?.state).toBe("releasing");
  });

  it("throws REPAIR_NOT_AVAILABLE when resume-acquire intent is missing", () => {
    const lease = leasedLease({ state: "quarantined" });
    expect(() => transitionLease(lease, { type: "REPAIR_RESUME_ACQUIRE" }, NOW)).toThrowError(
      RepairNotAvailableError,
    );
  });

  it("throws REPAIR_NOT_AVAILABLE when resume-cleanup intent is missing", () => {
    const lease = leasedLease({ state: "quarantined" });
    expect(() => transitionLease(lease, { type: "REPAIR_RESUME_CLEANUP" }, NOW)).toThrowError(
      RepairNotAvailableError,
    );
  });

  it("preparing -> quarantined on QUARANTINE and preserves pendingAcquire", () => {
    const lease = createPreparingLease({
      leaseId: "job-1",
      slotName: "slot-1",
      path: "/pool/slot-1",
      repoRoot: "/repo",
      pendingAcquire: { target: TARGET, startedAt: NOW },
      now: NOW,
    });
    const next = transitionLease(lease, { type: "QUARANTINE", reason: "stuck" }, NOW);
    expect(next?.state).toBe("quarantined");
    expect(next?.pendingAcquire).toEqual(lease.pendingAcquire);
  });

  it("releasing -> quarantined on QUARANTINE and clears pendingCleanup", () => {
    const lease = leasedLease({
      state: "releasing",
      pendingCleanup: { cleanup: "preserve" },
    });
    const next = transitionLease(lease, { type: "QUARANTINE", reason: "stuck" }, NOW);
    expect(next?.state).toBe("quarantined");
    expect(next?.pendingCleanup).toBeUndefined();
  });

  const invalidLeaseTransitions: Array<{
    name: string;
    lease: GroveLeaseRecord;
    event: LeaseEvent;
  }> = [
    {
      name: "ACQUIRE_COMPLETE from leased",
      lease: leasedLease(),
      event: { type: "ACQUIRE_COMPLETE", target: TARGET, headSha: "abc123" },
    },
    {
      name: "RELEASE_START from preparing",
      lease: createPreparingLease({
        leaseId: "job-1",
        slotName: "slot-1",
        path: "/pool/slot-1",
        repoRoot: "/repo",
        pendingAcquire: { target: TARGET, startedAt: NOW },
        now: NOW,
      }),
      event: { type: "RELEASE_START", cleanup: { cleanup: "preserve" } },
    },
    {
      name: "DESTROY_START from preparing",
      lease: createPreparingLease({
        leaseId: "job-1",
        slotName: "slot-1",
        path: "/pool/slot-1",
        repoRoot: "/repo",
        pendingAcquire: { target: TARGET, startedAt: NOW },
        now: NOW,
      }),
      event: { type: "DESTROY_START" },
    },
    {
      name: "ACQUIRE_POST_CREATE_COMPLETE from leased",
      lease: leasedLease(),
      event: { type: "ACQUIRE_POST_CREATE_COMPLETE" },
    },
    {
      name: "ACQUIRE_POST_CREATE_COMPLETE without pending work",
      lease: createPreparingLease({
        leaseId: "job-1",
        slotName: "slot-1",
        path: "/pool/slot-1",
        repoRoot: "/repo",
        pendingAcquire: { target: TARGET, startedAt: NOW, postCreatePending: false },
        now: NOW,
      }),
      event: { type: "ACQUIRE_POST_CREATE_COMPLETE" },
    },
    {
      name: "RELEASE_PRESERVE_COMPLETE from leased",
      lease: leasedLease(),
      event: { type: "RELEASE_PRESERVE_COMPLETE" },
    },
    {
      name: "DESTROY_COMPLETE from leased",
      lease: leasedLease(),
      event: { type: "DESTROY_COMPLETE" },
    },
  ];

  it.each(invalidLeaseTransitions)("throws INVALID_TRANSITION for $name", ({ lease, event }) => {
    expect(() => transitionLease(lease, event, NOW)).toThrowError(InvalidTransitionError);
  });
});

describe("transitionSlot", () => {
  it("available -> leased on RESERVE_FOR_LEASE", () => {
    const slot = leasedSlot({ state: "available" });
    const next = transitionSlot(slot, { type: "RESERVE_FOR_LEASE" }, NOW);
    expect(next?.state).toBe("leased");
  });

  it("leased -> available on RELEASE_TO_POOL", () => {
    const next = transitionSlot(leasedSlot(), { type: "RELEASE_TO_POOL" }, NOW);
    expect(next?.state).toBe("available");
  });

  it("leased -> quarantined on QUARANTINE and clears owner fields", () => {
    const next = transitionSlot(
      leasedSlot({ ownerPid: 1234, ownerStartedAt: 1_700_000_000 }),
      { type: "QUARANTINE", reason: "manual" },
      NOW,
    );
    expect(next?.state).toBe("quarantined");
    expect(next?.ownerPid).toBeUndefined();
    expect(next?.ownerStartedAt).toBeUndefined();
  });

  it("leased -> destroying on DESTROY_START", () => {
    const next = transitionSlot(leasedSlot(), { type: "DESTROY_START" }, NOW);
    expect(next?.state).toBe("destroying");
  });

  it("destroying -> removed on DESTROY_COMPLETE", () => {
    const slot = leasedSlot({ state: "destroying" });
    expect(transitionSlot(slot, { type: "DESTROY_COMPLETE" }, NOW)).toBeNull();
  });

  it("destroying -> quarantined on QUARANTINE", () => {
    const next = transitionSlot(leasedSlot({ state: "destroying" }), { type: "QUARANTINE" }, NOW);
    expect(next?.state).toBe("quarantined");
  });

  it("destroying -> available on RECLAIM_DESTROYING_SLOT", () => {
    const next = transitionSlot(
      leasedSlot({ state: "destroying" }),
      { type: "RECLAIM_DESTROYING_SLOT" },
      NOW,
    );
    expect(next?.state).toBe("available");
    expect(next?.updatedAt).toBe(NOW);
    expect(next?.slotName).toBe("slot-1");
    expect(next?.path).toBe("/pool/slot-1");
  });

  const invalidSlotTransitions: Array<{
    name: string;
    slot: GroveSlot;
    event: SlotEvent;
  }> = [
    {
      name: "RESERVE_FOR_LEASE from leased",
      slot: leasedSlot(),
      event: { type: "RESERVE_FOR_LEASE" },
    },
    {
      name: "RELEASE_TO_POOL from available",
      slot: leasedSlot({ state: "available" }),
      event: { type: "RELEASE_TO_POOL" },
    },
    {
      name: "DESTROY_COMPLETE from leased",
      slot: leasedSlot(),
      event: { type: "DESTROY_COMPLETE" },
    },
    {
      name: "RECLAIM_DESTROYING_SLOT from leased",
      slot: leasedSlot(),
      event: { type: "RECLAIM_DESTROYING_SLOT" },
    },
  ];

  it.each(invalidSlotTransitions)("throws INVALID_TRANSITION for $name", ({ slot, event }) => {
    expect(() => transitionSlot(slot, event, NOW)).toThrowError(InvalidTransitionError);
  });
});

describe("assertJointInvariants", () => {
  it("accepts a valid leased slot-lease pair", () => {
    expect(() => assertJointInvariants(jointState(leasedLease()))).not.toThrow();
  });

  it("accepts available slot with no lease", () => {
    expect(() =>
      assertJointInvariants({
        slots: [leasedSlot({ state: "available" })],
        leases: [],
      }),
    ).not.toThrow();
  });

  it("rejects duplicate leaseId values", () => {
    const lease = leasedLease();
    expect(() =>
      assertJointInvariants({
        slots: [leasedSlot(), leasedSlot({ slotName: "slot-2", path: "/pool/slot-2" })],
        leases: [lease, { ...lease, slotName: "slot-2", path: "/pool/slot-2" }],
      }),
    ).toThrowError(InvalidGroveStateError);
  });

  it("rejects duplicate leases on the same slot", () => {
    expect(() =>
      assertJointInvariants({
        slots: [leasedSlot()],
        leases: [
          leasedLease({ leaseId: "job-1" }),
          leasedLease({ leaseId: "job-2" }),
        ],
      }),
    ).toThrowError(InvalidGroveStateError);
  });

  it("rejects lease pointing at an available slot", () => {
    expect(() =>
      assertJointInvariants({
        slots: [leasedSlot({ state: "available" })],
        leases: [leasedLease()],
      }),
    ).toThrowError(InvalidGroveStateError);
  });

  it("rejects preparing lease without pendingAcquire", () => {
    const lease = leasedLease({ state: "preparing", target: undefined });
    expect(() => assertJointInvariants(jointState(lease))).toThrowError(InvalidGroveStateError);
  });

  it("rejects releasing lease without pendingCleanup", () => {
    const lease = leasedLease({ state: "releasing", pendingCleanup: undefined });
    expect(() => assertJointInvariants(jointState(lease))).toThrowError(InvalidGroveStateError);
  });

  it("rejects quarantined lease with non-quarantined slot", () => {
    const lease = leasedLease({ state: "quarantined" });
    expect(() => assertJointInvariants(jointState(lease, leasedSlot()))).toThrowError(
      InvalidGroveStateError,
    );
  });

  it("rejects destroying lease with non-destroying slot", () => {
    const lease = leasedLease({ state: "destroying" });
    expect(() => assertJointInvariants(jointState(lease, leasedSlot()))).toThrowError(
      InvalidGroveStateError,
    );
  });

  it("rejects leased slot without a lease record", () => {
    expect(() =>
      assertJointInvariants({
        slots: [leasedSlot()],
        leases: [],
      }),
    ).toThrowError(InvalidGroveStateError);
  });

  it("rejects duplicate slotName values", () => {
    expect(() =>
      assertJointInvariants({
        slots: [leasedSlot(), leasedSlot({ slotName: "slot-1", path: "/pool/slot-1-dup" })],
        leases: [],
      }),
    ).toThrowError(/Duplicate slotName/);
  });

  it("rejects leased lease without head identity", () => {
    const lease = leasedLease({ acquiredHeadSha: undefined, currentHeadSha: undefined });
    expect(() => assertJointInvariants(jointState(lease))).toThrowError(/acquiredHeadSha/);
  });
});
