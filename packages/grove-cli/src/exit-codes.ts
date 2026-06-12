import type { GroveErrorCode } from "@ferueda/grove";

const EXIT_CODES: Partial<Record<GroveErrorCode, number>> = {
  INVALID_INPUT: 2,
  LEASE_CONFLICT: 3,
  LEASE_ALREADY_EXISTS: 3,
  GROVE_EXHAUSTED: 4,
  POOL_EXHAUSTED: 4,
  GIT_NOT_FOUND: 5,
  GIT_COMMAND_FAILED: 5,
  LOCK_FAILED: 6,
  UNSAFE_CLEANUP: 7,
  PROCESS_SAFETY_UNVERIFIED: 7,
  WORKTREE_IN_USE: 7,
  LEASE_NOT_FOUND: 8,
  WORKTREE_NOT_MANAGED: 8,
  LEASE_QUARANTINED: 9,
  LEASE_BUSY: 9,
  ACQUIRE_IN_PROGRESS: 9,
  REPAIR_NOT_AVAILABLE: 10,
  INVALID_TRANSITION: 10,
  INVALID_GROVE_STATE: 11,
  PATH_OUTSIDE_POOL: 12,
  BRANCH_EXISTS: 13,
  BRANCH_NOT_FOUND: 13,
  REF_NOT_FOUND: 13,
  HOOK_FAILED: 14,
};

export function exitCodeForError(err: unknown): number {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: GroveErrorCode }).code;
    return EXIT_CODES[code] ?? 1;
  }
  return 1;
}
