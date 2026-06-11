import { resolveGroveDir } from "./config.js";
import { Grove } from "./pool.js";
import { GroveConfigSchema } from "./schemas.js";
import type { GroveConfig } from "./schemas.js";

export { Grove } from "./pool.js";
export type {
  AcquiredSlot,
  AcquireLeaseOptions,
  ReleaseLeaseOptions,
  DestroyLeaseOptions,
  RepairLeaseOptions,
  GroveLease,
  WorktreeStatus,
  WorktreeStatusInfo,
} from "./types.js";
export { GroveConfigSchema } from "./schemas.js";
export type { GroveConfig, WorktreeEntry, GroveState, GroveCleanupIntent } from "./schemas.js";

export {
  GroveError,
  GroveExhaustedError,
  WorktreeDestroyingError,
  WorktreeNotManagedError,
  WorktreeInUseError,
  GitNotFoundError,
  GitCommandError,
  InvalidGroveStateError,
  LockFailedError,
  LeaseNotFoundError,
  LeaseConflictError,
  LeaseAlreadyExistsError,
  LeaseQuarantinedError,
  UnsafeCleanupError,
  BranchExistsError,
  BranchNotFoundError,
  RefNotFoundError,
  PathOutsidePoolError,
  BranchDeleteFailedError,
  HookFailedError,
} from "./errors.js";
export type { GroveErrorCode } from "./errors.js";

export async function createGrove(configInput: GroveConfig): Promise<Grove> {
  const config = GroveConfigSchema.parse(configInput);
  const groveDir =
    config.groveDir || (await resolveGroveDir(config.repoRoot, config.groveRoot || ""));
  return new Grove(groveDir, config);
}
