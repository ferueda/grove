import { resolveGroveDir } from "./config.js";
import { Grove } from "./pool.js";
import { GroveConfigSchema } from "./schemas.js";
import type { GroveConfig } from "./schemas.js";

export { Grove } from "./pool.js";
export { isReleaseResult, isRepairResult } from "./types.js";
export type {
  AcquiredSlot,
  AcquireLeaseOptions,
  ReleaseLeaseOptions,
  ReleaseResult,
  RepairResult,
  DestroyLeaseOptions,
  RepairLeaseOptions,
  GroveLease,
  WorktreeStatus,
  WorktreeStatusInfo,
} from "./types.js";
export { GroveConfigSchema } from "./schemas.js";
export type {
  GroveConfig,
  WorktreeEntry,
  GroveState,
  GroveCleanupIntent,
  GroveLeaseTarget,
  PendingAcquire,
  GroveSlot,
  GroveLeaseRecord,
  LeaseFirstGroveState,
  ProcessSafetyDiagnostic,
} from "./schemas.js";

export {
  GroveError,
  GroveExhaustedError,
  PoolExhaustedError,
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
  LeaseBusyError,
  AcquireInProgressError,
  UnsafeCleanupError,
  ProcessSafetyUnverifiedError,
  BranchExistsError,
  BranchNotFoundError,
  RefNotFoundError,
  PathOutsidePoolError,
  InvalidInputError,
  InvalidTransitionError,
  RepairNotAvailableError,
  BranchDeleteFailedError,
  HookFailedError,
} from "./errors.js";
export type { GroveErrorCode } from "./errors.js";

export {
  transitionLease,
  transitionSlot,
  assertJointInvariants,
  createPreparingLease,
} from "./transitions.js";
export type { LeaseEvent, SlotEvent } from "./transitions.js";

export {
  parseLeaseFirstState,
  migrateLegacyToLeaseFirst,
  readLeaseFirstState,
  writeLeaseFirstState,
} from "./state-v1.js";
export type { ParseLeaseFirstStateOptions } from "./state-v1.js";

export async function createGrove(configInput: GroveConfig): Promise<Grove> {
  const config = GroveConfigSchema.parse(configInput);
  const groveDir =
    config.groveDir || (await resolveGroveDir(config.repoRoot, config.groveRoot || ""));
  return new Grove(groveDir, config);
}
