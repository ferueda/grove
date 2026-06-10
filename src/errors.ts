export type GroveErrorCode =
  | 'GROVE_EXHAUSTED'
  | 'WORKTREE_DESTROYING'
  | 'WORKTREE_NOT_MANAGED'
  | 'WORKTREE_IN_USE'
  | 'GIT_NOT_FOUND'
  | 'GIT_COMMAND_FAILED'
  | 'INVALID_GROVE_STATE'
  | 'LOCK_FAILED';

export class GroveError extends Error {
  readonly code: GroveErrorCode;
  constructor(message: string, code: GroveErrorCode) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class GroveExhaustedError extends GroveError {
  constructor(message: string = 'Grove exhausted') {
    super(message, 'GROVE_EXHAUSTED');
  }
}

export class WorktreeDestroyingError extends GroveError {
  constructor(message: string = 'Worktree is destroying') {
    super(message, 'WORKTREE_DESTROYING');
  }
}

export class WorktreeNotManagedError extends GroveError {
  constructor(message: string = 'Worktree not managed') {
    super(message, 'WORKTREE_NOT_MANAGED');
  }
}

export class WorktreeInUseError extends GroveError {
  constructor(message: string = 'Worktree is in use') {
    super(message, 'WORKTREE_IN_USE');
  }
}

export class GitNotFoundError extends GroveError {
  constructor(message: string = 'Git not found') {
    super(message, 'GIT_NOT_FOUND');
  }
}

export class GitCommandError extends GroveError {
  stderr: string;
  constructor(message: string, stderr: string = '') {
    super(message, 'GIT_COMMAND_FAILED');
    this.stderr = stderr;
  }
}

export class InvalidGroveStateError extends GroveError {
  constructor(message: string = 'Invalid grove state') {
    super(message, 'INVALID_GROVE_STATE');
  }
}

export class LockFailedError extends GroveError {
  constructor(message: string = 'Failed to acquire lock') {
    super(message, 'LOCK_FAILED');
  }
}
