import { readFile, writeFile, rename } from "node:fs/promises";
import {
  GroveStateSchema,
  LeaseFirstCleanupIntentSchema,
  LeaseFirstGroveStateSchema,
  type GroveLeaseRecord,
  type GroveLeaseTarget,
  type GroveSlot,
  type GroveState,
  type LeaseFirstGroveState,
  type WorktreeEntry,
} from "./schemas.js";
import { InvalidGroveStateError } from "./errors.js";
import { assertJointInvariants } from "./transitions.js";
import { stateFilePath } from "./state.js";

export type ParseLeaseFirstStateOptions = {
  repoRoot?: string;
};

function mapLegacySlotState(entry: WorktreeEntry): GroveSlot["state"] {
  if (entry.destroying || entry.state === "destroying") {
    return "destroying";
  }
  if (entry.state === "quarantined") {
    return "quarantined";
  }
  if (entry.leaseId || entry.state === "leased" || entry.state === "releasing") {
    return "leased";
  }
  return "available";
}

function mapLegacyLeaseState(entry: WorktreeEntry): GroveLeaseRecord["state"] {
  if (entry.state === "quarantined") {
    return "quarantined";
  }
  if (entry.state === "destroying" || entry.destroying) {
    return "destroying";
  }
  if (entry.state === "releasing") {
    return "releasing";
  }
  return "leased";
}

function legacyTarget(entry: WorktreeEntry): GroveLeaseTarget | undefined {
  if (entry.branch) {
    const requestedRef = entry.baseRef ?? entry.branch;
    const resolvedRefSha = entry.baseSha ?? entry.acquiredHeadSha;
    const branchHeadShaAtAcquire = entry.acquiredHeadSha ?? entry.currentHeadSha;
    if (!resolvedRefSha || !branchHeadShaAtAcquire) {
      return undefined;
    }
    return {
      mode: "branch",
      branch: entry.branch,
      requestedRef,
      resolvedRefSha,
      branchHeadShaAtAcquire,
      createFromRef: entry.baseRef,
      createFromSha: entry.baseSha,
    };
  }

  if (entry.baseRef && entry.baseSha) {
    return {
      mode: "detached",
      requestedRef: entry.baseRef,
      resolvedRefSha: entry.baseSha,
    };
  }

  return undefined;
}

export function migrateLegacyToLeaseFirst(
  legacy: GroveState,
  options: ParseLeaseFirstStateOptions = {},
): LeaseFirstGroveState {
  const repoRoot = options.repoRoot ?? "";
  const slots: GroveSlot[] = [];
  const leases: GroveLeaseRecord[] = [];

  for (const entry of legacy.worktrees) {
    const createdAt = entry.created_at;
    const updatedAt = entry.updatedAt ?? entry.created_at;

    slots.push({
      slotName: entry.name,
      path: entry.path,
      state: mapLegacySlotState(entry),
      createdAt,
      updatedAt,
    });

    if (!entry.leaseId) {
      continue;
    }

    const leaseState = mapLegacyLeaseState(entry);
    const target = legacyTarget(entry);
    const lease: GroveLeaseRecord = {
      leaseId: entry.leaseId,
      ownerId: entry.ownerId,
      slotName: entry.name,
      path: entry.path,
      repoRoot,
      state: leaseState,
      createdAt,
      updatedAt,
    };

    if (target) {
      lease.target = target;
    }
    if (entry.acquiredHeadSha) {
      lease.acquiredHeadSha = entry.acquiredHeadSha;
    }
    if (entry.currentHeadSha) {
      lease.currentHeadSha = entry.currentHeadSha;
    }
    if (entry.pendingCleanup) {
      const cleanup = LeaseFirstCleanupIntentSchema.safeParse(entry.pendingCleanup);
      if (!cleanup.success) {
        throw new InvalidGroveStateError(
          `Invalid legacy pendingCleanup for lease ${entry.leaseId}`,
        );
      }
      lease.pendingCleanup = cleanup.data;
    }
    if (entry.processSafety) {
      lease.diagnostics = {
        lastProcessSafetyCheck: {
          status: entry.processSafety,
          checkedAt: updatedAt,
        },
      };
    }

    leases.push(lease);
  }

  return { slots, leases };
}

export function parseLeaseFirstState(
  raw: unknown,
  options: ParseLeaseFirstStateOptions = {},
): LeaseFirstGroveState {
  if (raw === null || typeof raw !== "object") {
    throw new InvalidGroveStateError("State must be an object");
  }

  const record = raw as Record<string, unknown>;

  if ("slots" in record || "leases" in record) {
    const parsed = LeaseFirstGroveStateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new InvalidGroveStateError("Lease-first state validation failed");
    }
    assertJointInvariants(parsed.data);
    return parsed.data;
  }

  if ("worktrees" in record) {
    const legacy = GroveStateSchema.safeParse(raw);
    if (!legacy.success) {
      throw new InvalidGroveStateError("Legacy state validation failed");
    }
    const migrated = migrateLegacyToLeaseFirst(legacy.data, options);
    const reparsed = LeaseFirstGroveStateSchema.safeParse(migrated);
    if (!reparsed.success) {
      throw new InvalidGroveStateError("Migrated state validation failed");
    }
    assertJointInvariants(reparsed.data);
    return reparsed.data;
  }

  throw new InvalidGroveStateError("Unrecognized grove state shape");
}

export async function readLeaseFirstState(
  groveDir: string,
  options: ParseLeaseFirstStateOptions = {},
): Promise<LeaseFirstGroveState> {
  let data: string;
  try {
    data = await readFile(stateFilePath(groveDir), "utf8");
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { slots: [], leases: [] };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new InvalidGroveStateError("Invalid JSON format");
  }

  return parseLeaseFirstState(parsed, options);
}

export async function writeLeaseFirstState(
  groveDir: string,
  state: LeaseFirstGroveState,
): Promise<void> {
  const parsed = LeaseFirstGroveStateSchema.safeParse(state);
  if (!parsed.success) {
    throw new InvalidGroveStateError("Lease-first state validation failed");
  }
  assertJointInvariants(parsed.data);

  const data = JSON.stringify(parsed.data, null, 2);
  const target = stateFilePath(groveDir);
  const tmp = `${target}.tmp`;
  await writeFile(tmp, data, { mode: 0o644 });
  await rename(tmp, target);
}
