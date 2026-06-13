import type { AcquireLeaseOptions } from "./types.js";
import type { GroveLeaseRecord, GroveLeaseTarget, PendingAcquire } from "./schemas.js";
import { validateBranchName, resolveRef, getHeadSha } from "./git/index.js";
import {
  AcquireInProgressError,
  LeaseBusyError,
  LeaseConflictError,
  LeaseQuarantinedError,
} from "./errors.js";

function leaseStateDetails(lease: GroveLeaseRecord): Record<string, unknown> {
  return { leaseId: lease.leaseId, existingState: lease.state };
}

function conflictDetails(
  existing: GroveLeaseRecord,
  requested: GroveLeaseTarget,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    leaseId: existing.leaseId,
    existingState: existing.state,
    ...(existing.target ? { existingTarget: existing.target } : {}),
    requestedTarget: requested,
    ...extra,
  };
}

export async function buildAcquireTarget(
  options: AcquireLeaseOptions,
  repoRoot: string,
): Promise<GroveLeaseTarget> {
  if (options.mode === "detached") {
    const resolvedRefSha = await resolveRef(repoRoot, options.ref);
    return {
      mode: "detached",
      requestedRef: options.ref,
      resolvedRefSha,
    };
  }

  await validateBranchName(repoRoot, options.branch);

  if (options.createBranch) {
    const createFromSha = await resolveRef(repoRoot, options.createBranch.from);
    return {
      mode: "branch",
      branch: options.branch,
      requestedRef: options.branch,
      resolvedRefSha: createFromSha,
      branchHeadShaAtAcquire: createFromSha,
      createFromRef: options.createBranch.from,
      createFromSha,
    };
  }

  try {
    const branchHeadSha = await resolveRef(repoRoot, options.branch);
    return {
      mode: "branch",
      branch: options.branch,
      requestedRef: options.branch,
      resolvedRefSha: branchHeadSha,
      branchHeadShaAtAcquire: branchHeadSha,
    };
  } catch {
    // Branch may not exist yet; checkout will surface BranchNotFoundError.
    // Omit SHA fields until checkout finalizes the normalized target.
    return {
      mode: "branch",
      branch: options.branch,
      requestedRef: options.branch,
    };
  }
}

export function buildPendingAcquire(target: GroveLeaseTarget, startedAt: string): PendingAcquire {
  return { target, startedAt };
}

export function finalizeBranchTarget(target: GroveLeaseTarget, headSha: string): GroveLeaseTarget {
  if (target.mode !== "branch") {
    return target;
  }
  return {
    ...target,
    resolvedRefSha: headSha,
    branchHeadShaAtAcquire: headSha,
  };
}

export async function assertCompatibleReacquire(
  existing: GroveLeaseRecord,
  options: AcquireLeaseOptions,
  repoRoot: string,
): Promise<void> {
  if (existing.state === "preparing") {
    throw new AcquireInProgressError(
      `Acquire in progress for lease ${existing.leaseId}`,
      leaseStateDetails(existing),
    );
  }
  if (existing.state === "quarantined") {
    throw new LeaseQuarantinedError(
      `Lease ${existing.leaseId} is quarantined`,
      leaseStateDetails(existing),
    );
  }
  if (existing.state === "releasing" || existing.state === "destroying") {
    throw new LeaseBusyError(`Lease ${existing.leaseId} is busy`, leaseStateDetails(existing));
  }
  if (existing.state !== "leased" || !existing.target) {
    throw new LeaseConflictError(
      `Lease ${existing.leaseId} is not in a reacquirable state`,
      leaseStateDetails(existing),
    );
  }

  const requested = await buildAcquireTarget(options, repoRoot);

  if (requested.mode !== existing.target.mode) {
    throw new LeaseConflictError(
      `Lease conflict: mode mismatch for ${existing.leaseId}`,
      conflictDetails(existing, requested),
    );
  }

  if (requested.mode === "detached") {
    const stored = existing.target;
    if (
      requested.requestedRef !== stored.requestedRef ||
      requested.resolvedRefSha !== stored.resolvedRefSha
    ) {
      throw new LeaseConflictError(
        `Lease conflict: requested ref ${requested.requestedRef} does not match existing detached base or SHA`,
        conflictDetails(existing, requested, {
          existingRef: stored.requestedRef,
          requestedRef: requested.requestedRef,
        }),
      );
    }
    return;
  }

  const stored = existing.target;
  if (stored.mode !== "branch") {
    throw new LeaseConflictError(
      `Lease conflict: mode mismatch for ${existing.leaseId}`,
      conflictDetails(existing, requested),
    );
  }

  if (requested.branch !== stored.branch) {
    throw new LeaseConflictError(
      `Lease conflict: requested branch ${requested.branch}, existing has ${stored.branch}`,
      conflictDetails(existing, requested, {
        existingBranch: stored.branch,
        requestedBranch: requested.branch,
      }),
    );
  }

  const requestedCreateFrom = options.mode === "branch" ? options.createBranch?.from : undefined;
  if (requestedCreateFrom !== undefined) {
    if ((stored.createFromRef ?? undefined) !== requestedCreateFrom) {
      throw new LeaseConflictError(
        `Lease conflict: createFrom mismatch for ${existing.leaseId}`,
        conflictDetails(existing, requested, {
          existingCreateFromRef: stored.createFromRef,
          requestedCreateFromRef: requestedCreateFrom,
        }),
      );
    }
    const requestedSha = await resolveRef(repoRoot, requestedCreateFrom);
    if (stored.createFromSha && stored.createFromSha !== requestedSha) {
      throw new LeaseConflictError(
        `Lease conflict: createFromSha mismatch for ${existing.leaseId}`,
        conflictDetails(existing, requested, {
          existingCreateFromSha: stored.createFromSha,
          requestedCreateFromSha: requestedSha,
        }),
      );
    }
  }

  if (!stored.branchHeadShaAtAcquire) {
    throw new LeaseConflictError(
      `Lease conflict: branch ${stored.branch} has no recorded head for ${existing.leaseId}`,
      conflictDetails(existing, requested, { existingBranch: stored.branch }),
    );
  }

  const branchHead = await resolveRef(repoRoot, stored.branch);
  if (branchHead === stored.branchHeadShaAtAcquire) {
    return;
  }

  let worktreeHead = existing.currentHeadSha;
  try {
    worktreeHead = await getHeadSha(existing.path);
  } catch {
    // use stored value
  }

  // Worktree on branch tip: commits made inside this lease advanced both refs together.
  if (worktreeHead === branchHead) {
    return;
  }

  throw new LeaseConflictError(
    `Lease conflict: branch ${stored.branch} moved outside lease ${existing.leaseId}`,
    conflictDetails(existing, requested, {
      existingBranch: stored.branch,
      branchHeadShaAtAcquire: stored.branchHeadShaAtAcquire,
      currentBranchHead: branchHead,
    }),
  );
}

export function branchOwnedByOtherLease(
  leases: readonly GroveLeaseRecord[],
  branch: string,
  excludeLeaseId: string,
): boolean {
  return leases.some(
    (lease) =>
      lease.leaseId !== excludeLeaseId &&
      lease.target?.mode === "branch" &&
      lease.target.branch === branch &&
      lease.state !== "destroying",
  );
}
