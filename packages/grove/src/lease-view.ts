import { existsSync } from "node:fs";
import type { GroveLeaseRecord, GroveLeaseTarget, LeaseFirstGroveState } from "./schemas.js";
import type { GroveLease } from "./types.js";
import { getHeadSha } from "./git/index.js";
import { findInWorktree } from "./process/detect.js";

export function targetBranch(target: GroveLeaseTarget | undefined): string | undefined {
  return target?.mode === "branch" ? target.branch : undefined;
}

export function targetBaseRef(target: GroveLeaseTarget | undefined): string | undefined {
  if (!target) return undefined;
  return target.mode === "detached" ? target.requestedRef : target.requestedRef;
}

export function targetBaseSha(target: GroveLeaseTarget | undefined): string | undefined {
  return target?.resolvedRefSha;
}

/** Hook env vars passed to pre/post acquire, release, and destroy hooks. */
export function buildLeaseHookEnv(lease: GroveLease): Record<string, string> {
  const env: Record<string, string> = {
    GROVE_LEASE_ID: lease.leaseId,
    GROVE_SLOT_NAME: lease.slotName,
    GROVE_REPO_ROOT: lease.repoRoot,
    GROVE_WORKTREE_PATH: lease.path,
  };
  if (lease.ownerId) env.GROVE_OWNER_ID = lease.ownerId;
  if (lease.branch) env.GROVE_BRANCH = lease.branch;
  if (lease.baseRef) env.GROVE_BASE_REF = lease.baseRef;
  if (lease.baseSha) env.GROVE_BASE_SHA = lease.baseSha;
  return env;
}

export function recordToGroveLease(
  lease: GroveLeaseRecord,
  processSafety: "verified" | "unverified" = "verified",
): GroveLease {
  return {
    leaseId: lease.leaseId,
    ownerId: lease.ownerId,
    slotName: lease.slotName,
    path: lease.path,
    repoRoot: lease.repoRoot,
    branch: targetBranch(lease.target),
    baseRef: targetBaseRef(lease.target),
    baseSha: targetBaseSha(lease.target),
    target: lease.target,
    acquiredHeadSha: lease.acquiredHeadSha ?? "",
    currentHeadSha: lease.currentHeadSha ?? "",
    state: lease.state,
    pendingAcquire: lease.pendingAcquire,
    pendingCleanup: lease.pendingCleanup,
    diagnostics: lease.diagnostics,
    metadata: lease.metadata,
    processSafety,
    createdAt: lease.createdAt,
    updatedAt: lease.updatedAt,
  };
}

export async function enrichLeaseReadOnly(lease: GroveLeaseRecord): Promise<GroveLease> {
  const missingPath = !existsSync(lease.path);
  if (missingPath) {
    lease.diagnostics = { ...lease.diagnostics, missingPath: true };
  } else {
    try {
      lease.currentHeadSha = await getHeadSha(lease.path);
    } catch {
      // best-effort
    }
  }

  const { unverified } = missingPath ? { unverified: true } : await findInWorktree(lease.path);

  if (unverified) {
    lease.diagnostics = {
      ...lease.diagnostics,
      lastProcessSafetyCheck: {
        status: "unverified",
        checkedAt: new Date().toISOString(),
      },
    };
  }

  return recordToGroveLease(lease, unverified ? "unverified" : "verified");
}

export async function inspectLeaseRecord(
  state: LeaseFirstGroveState,
  leaseId: string,
): Promise<GroveLease | null> {
  const lease = state.leases.find((entry) => entry.leaseId === leaseId);
  if (!lease) return null;
  return enrichLeaseReadOnly({ ...lease });
}

export async function listLeaseRecords(
  state: LeaseFirstGroveState,
  options?: { includeProcesses?: boolean },
): Promise<GroveLease[]> {
  const leases: GroveLease[] = [];
  for (const lease of state.leases) {
    const copy = { ...lease };
    if (options?.includeProcesses && existsSync(copy.path)) {
      const scan = await findInWorktree(copy.path);
      copy.diagnostics = {
        ...copy.diagnostics,
        lastProcessSafetyCheck: {
          status: scan.unverified ? "unverified" : "verified",
          checkedAt: new Date().toISOString(),
          processes: scan.processes,
        },
      };
    }
    leases.push(await enrichLeaseReadOnly(copy));
  }
  return leases;
}
