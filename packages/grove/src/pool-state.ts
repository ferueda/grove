import { join, basename, dirname } from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type {
  GroveConfig,
  GroveLeaseRecord,
  GroveSlot,
  LeaseFirstGroveState,
  WorktreeEntry,
} from "./schemas.js";
import { readLeaseFirstState, writeLeaseFirstState } from "./state-v1.js";
import { addWorktree, isDirty, resetWorktree } from "./git/index.js";
import { ownerAlive, isWorktreeInUse, reserveOwner } from "./process/detect.js";
import { GroveExhaustedError } from "./errors.js";
import { transitionLease, transitionSlot } from "./transitions.js";

export async function healPoolState(state: LeaseFirstGroveState): Promise<LeaseFirstGroveState> {
  const slots: GroveSlot[] = [];
  for (const slot of state.slots) {
    if (!existsSync(slot.path)) {
      continue;
    }
    if (slot.ownerPid !== undefined && !(await ownerAlive(slotOwnerEntry(slot)))) {
      await clearSlotOwner(slot);
    }
    if (slot.state === "destroying" && !(await ownerAlive(slotOwnerEntry(slot)))) {
      const lease = leaseForSlot(state, slot.slotName);
      if (!lease || lease.state !== "destroying") {
        slot.state = "available";
        await clearSlotOwner(slot);
      }
    }
    slots.push(slot);
  }
  return { slots, leases: state.leases };
}

export async function loadPoolState(
  poolDir: string,
  repoRoot: string,
  options?: { heal?: boolean },
): Promise<LeaseFirstGroveState> {
  const state = await readLeaseFirstState(poolDir, { repoRoot });
  if (options?.heal === false) {
    return state;
  }
  return healPoolState(state);
}

export async function savePoolState(
  poolDir: string,
  state: LeaseFirstGroveState,
): Promise<void> {
  await writeLeaseFirstState(poolDir, state);
}

export function leaseForSlot(
  state: LeaseFirstGroveState,
  slotName: string,
): GroveLeaseRecord | undefined {
  return state.leases.find((lease) => lease.slotName === slotName);
}

export function findLease(
  state: LeaseFirstGroveState,
  leaseId: string,
): GroveLeaseRecord | undefined {
  return state.leases.find((lease) => lease.leaseId === leaseId);
}

export function findSlot(
  state: LeaseFirstGroveState,
  slotName: string,
): GroveSlot | undefined {
  return state.slots.find((slot) => slot.slotName === slotName);
}

export function applyLeaseSlotQuarantine(
  state: LeaseFirstGroveState,
  lease: GroveLeaseRecord,
  reason: string,
): void {
  const leaseIndex = state.leases.findIndex((entry) => entry.leaseId === lease.leaseId);
  if (lease.state !== "quarantined") {
    state.leases[leaseIndex] = transitionLease(lease, {
      type: "QUARANTINE",
      reason,
    })!;
  }

  const slot = findSlot(state, lease.slotName);
  if (!slot) {
    return;
  }

  if (slot.state !== "quarantined") {
    const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
    state.slots[slotIndex] = transitionSlot(slot, { type: "QUARANTINE", reason })!;
    return;
  }

  if (slot.ownerPid !== undefined || slot.ownerStartedAt !== undefined) {
    const slotIndex = state.slots.findIndex((entry) => entry.slotName === slot.slotName);
    state.slots[slotIndex] = {
      ...slot,
      ownerPid: undefined,
      ownerStartedAt: undefined,
      updatedAt: new Date().toISOString(),
    };
  }
}

export function nextSlotName(state: LeaseFirstGroveState): string {
  let max = 0;
  for (const slot of state.slots) {
    const n = parseInt(slot.slotName, 10);
    if (!isNaN(n) && n > max) {
      max = n;
    }
  }
  return (max + 1).toString();
}

function slotOwnerEntry(slot: GroveSlot): WorktreeEntry {
  return {
    name: slot.slotName,
    path: slot.path,
    created_at: slot.createdAt,
    owner_pid: slot.ownerPid,
    owner_started_at: slot.ownerStartedAt,
  };
}

export async function reserveSlotOwner(slot: GroveSlot): Promise<void> {
  const entry = slotOwnerEntry(slot);
  await reserveOwner(entry);
  slot.ownerPid = entry.owner_pid;
  slot.ownerStartedAt = entry.owner_started_at;
}

export async function clearSlotOwner(slot: GroveSlot): Promise<void> {
  slot.ownerPid = undefined;
  slot.ownerStartedAt = undefined;
}

export async function slotIsIdle(slot: GroveSlot): Promise<boolean> {
  const { inUse } = await isWorktreeInUse(slot.path);
  const alive = await ownerAlive(slotOwnerEntry(slot));
  return !inUse && !alive;
}

export async function findOrAllocateSlot(
  state: LeaseFirstGroveState,
  poolDir: string,
  config: GroveConfig,
  defaultBranch: string,
): Promise<{ slot: GroveSlot; isNew: boolean }> {
  for (const slot of state.slots) {
    if (slot.state === "destroying") {
      if (await slotIsIdle(slot)) {
        slot.state = "available";
        await clearSlotOwner(slot);
      } else {
        continue;
      }
    }
    if (slot.state !== "available") continue;
    if (leaseForSlot(state, slot.slotName)) continue;

    if (!(await slotIsIdle(slot))) continue;

    const dirty = await isDirty(slot.path);
    if (dirty) continue;

    try {
      await resetWorktree(slot.path, defaultBranch);
    } catch {
      continue;
    }

    return { slot, isNew: false };
  }

  const maxTrees = config.maxTrees || 16;
  if (state.slots.length >= maxTrees) {
    throw new GroveExhaustedError(`Exhausted worktrees (max ${maxTrees})`);
  }

  const slotName = nextSlotName(state);
  const repoName = basename(config.repoRoot);
  const wtPath = join(poolDir, slotName, repoName);

  await mkdir(dirname(wtPath), { recursive: true });
  await addWorktree(config.repoRoot, wtPath, defaultBranch);

  const now = new Date().toISOString();
  const slot: GroveSlot = {
    slotName,
    path: wtPath,
    state: "available",
    createdAt: now,
    updatedAt: now,
  };
  state.slots.push(slot);

  return { slot, isNew: true };
}

/** Bridge v1 slot to WorktreeEntry shape for process detection. */
export function slotToWorktreeEntry(
  slot: GroveSlot,
  lease?: GroveLeaseRecord,
): WorktreeEntry {
  return {
    name: slot.slotName,
    path: slot.path,
    created_at: slot.createdAt,
    updatedAt: slot.updatedAt,
    owner_pid: slot.ownerPid,
    owner_started_at: slot.ownerStartedAt,
    leaseId: lease?.leaseId,
    ownerId: lease?.ownerId,
    state:
      lease?.state === "preparing"
        ? "leased"
        : lease?.state === "releasing"
          ? "releasing"
          : lease?.state,
    branch: lease?.target?.mode === "branch" ? lease.target.branch : undefined,
    baseRef:
      lease?.target?.mode === "detached"
        ? lease.target.requestedRef
        : lease?.target?.mode === "branch"
          ? lease.target.requestedRef
          : undefined,
    baseSha:
      lease?.target?.mode === "detached"
        ? lease.target.resolvedRefSha
        : lease?.target?.mode === "branch"
          ? lease.target.resolvedRefSha
          : undefined,
    acquiredHeadSha: lease?.acquiredHeadSha,
    currentHeadSha: lease?.currentHeadSha,
    pendingCleanup: lease?.pendingCleanup,
    destroying: slot.state === "destroying" || lease?.state === "destroying",
  };
}
