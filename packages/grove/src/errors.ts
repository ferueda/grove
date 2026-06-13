export type GroveErrorCode =
  | "GROVE_EXHAUSTED"
  | "POOL_EXHAUSTED"
  | "WORKTREE_DESTROYING"
  | "WORKTREE_NOT_MANAGED"
  | "WORKTREE_IN_USE"
  | "GIT_NOT_FOUND"
  | "GIT_COMMAND_FAILED"
  | "INVALID_GROVE_STATE"
  | "LOCK_FAILED"
  | "LEASE_NOT_FOUND"
  | "LEASE_CONFLICT"
  | "LEASE_ALREADY_EXISTS"
  | "LEASE_QUARANTINED"
  | "LEASE_BUSY"
  | "ACQUIRE_IN_PROGRESS"
  | "UNSAFE_CLEANUP"
  | "PROCESS_SAFETY_UNVERIFIED"
  | "BRANCH_EXISTS"
  | "BRANCH_NOT_FOUND"
  | "REF_NOT_FOUND"
  | "PATH_OUTSIDE_POOL"
  | "INVALID_INPUT"
  | "INVALID_TRANSITION"
  | "REPAIR_NOT_AVAILABLE"
  | "BRANCH_DELETE_FAILED"
  | "HOOK_FAILED";

export class GroveError extends Error {
  readonly code: GroveErrorCode;
  readonly details: Record<string, unknown>;

  constructor(message: string, code: GroveErrorCode, details: Record<string, unknown> = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}

export class GroveExhaustedError extends GroveError {
  constructor(message: string = "Grove exhausted", details: Record<string, unknown> = {}) {
    super(message, "GROVE_EXHAUSTED", details);
  }
}

export class PoolExhaustedError extends GroveError {
  constructor(message: string = "Pool exhausted") {
    super(message, "POOL_EXHAUSTED");
  }
}

export class WorktreeDestroyingError extends GroveError {
  constructor(message: string = "Worktree is destroying") {
    super(message, "WORKTREE_DESTROYING");
  }
}

export class WorktreeNotManagedError extends GroveError {
  constructor(message: string = "Worktree not managed") {
    super(message, "WORKTREE_NOT_MANAGED");
  }
}

export class WorktreeInUseError extends GroveError {
  constructor(message: string = "Worktree is in use") {
    super(message, "WORKTREE_IN_USE");
  }
}

export class GitNotFoundError extends GroveError {
  constructor(message: string = "Git not found") {
    super(message, "GIT_NOT_FOUND");
  }
}

export class GitCommandError extends GroveError {
  stderr: string;
  constructor(message: string, stderr: string = "") {
    super(message, "GIT_COMMAND_FAILED");
    this.stderr = stderr;
  }
}

export class InvalidGroveStateError extends GroveError {
  constructor(message: string = "Invalid grove state") {
    super(message, "INVALID_GROVE_STATE");
  }
}

export class LockFailedError extends GroveError {
  constructor(message: string = "Failed to acquire lock") {
    super(message, "LOCK_FAILED");
  }
}

export class LeaseNotFoundError extends GroveError {
  constructor(message: string = "Lease not found") {
    super(message, "LEASE_NOT_FOUND");
  }
}

export class LeaseConflictError extends GroveError {
  constructor(message: string = "Lease conflict", details: Record<string, unknown> = {}) {
    super(message, "LEASE_CONFLICT", details);
  }
}

export class LeaseAlreadyExistsError extends GroveError {
  constructor(message: string = "Lease already exists") {
    super(message, "LEASE_ALREADY_EXISTS");
  }
}

export class LeaseQuarantinedError extends GroveError {
  constructor(message: string = "Lease quarantined", details: Record<string, unknown> = {}) {
    super(message, "LEASE_QUARANTINED", details);
  }
}

export class LeaseBusyError extends GroveError {
  constructor(message: string = "Lease is busy", details: Record<string, unknown> = {}) {
    super(message, "LEASE_BUSY", details);
  }
}

export class AcquireInProgressError extends GroveError {
  constructor(message: string = "Acquire in progress", details: Record<string, unknown> = {}) {
    super(message, "ACQUIRE_IN_PROGRESS", details);
  }
}

export class UnsafeCleanupError extends GroveError {
  constructor(message: string = "Unsafe cleanup") {
    super(message, "UNSAFE_CLEANUP");
  }
}

export class ProcessSafetyUnverifiedError extends GroveError {
  constructor(message: string = "Process safety unverified") {
    super(message, "PROCESS_SAFETY_UNVERIFIED");
  }
}

export class BranchExistsError extends GroveError {
  constructor(message: string = "Branch exists") {
    super(message, "BRANCH_EXISTS");
  }
}

export class BranchNotFoundError extends GroveError {
  constructor(message: string = "Branch not found") {
    super(message, "BRANCH_NOT_FOUND");
  }
}

export class RefNotFoundError extends GroveError {
  constructor(message: string = "Ref not found") {
    super(message, "REF_NOT_FOUND");
  }
}

export class PathOutsidePoolError extends GroveError {
  constructor(message: string = "Path outside pool boundary") {
    super(message, "PATH_OUTSIDE_POOL");
  }
}

export class InvalidInputError extends GroveError {
  constructor(message: string = "Invalid input") {
    super(message, "INVALID_INPUT");
  }
}

export class InvalidTransitionError extends GroveError {
  constructor(message: string = "Invalid transition") {
    super(message, "INVALID_TRANSITION");
  }
}

export class RepairNotAvailableError extends GroveError {
  constructor(message: string = "Repair not available") {
    super(message, "REPAIR_NOT_AVAILABLE");
  }
}

export class BranchDeleteFailedError extends GroveError {
  constructor(message: string) {
    super(message, "BRANCH_DELETE_FAILED");
  }
}

export class HookFailedError extends GroveError {
  constructor(message: string) {
    super(message, "HOOK_FAILED");
  }
}
