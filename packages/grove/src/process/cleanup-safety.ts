import type { GroveLeaseRecord, GroveSlot } from "../schemas.js";
import { UnsafeCleanupError } from "../errors.js";
import { slotToWorktreeEntry } from "../pool-state.js";
import { isWorktreeInUse, ownerAlive } from "./detect.js";

export type WorktreeCleanupSafetyOptions = {
  force?: boolean | undefined;
  ignoreOwnerReservation?: boolean | undefined;
  message?: string | undefined;
};

const DEFAULT_UNSAFE_MESSAGE =
  "Unsafe cleanup: active processes or unverified safety. Use force: true.";

export async function assertWorktreeSafeForCleanup(
  slotPath: string,
  slot: GroveSlot,
  lease: GroveLeaseRecord | undefined,
  options: WorktreeCleanupSafetyOptions = {},
): Promise<{ unverified: boolean }> {
  const message = options.message ?? DEFAULT_UNSAFE_MESSAGE;
  const { inUse, unverified } = await isWorktreeInUse(slotPath);
  if (options.force) {
    return { unverified };
  }

  const alive = options.ignoreOwnerReservation
    ? false
    : await ownerAlive(slotToWorktreeEntry(slot, lease));
  if (inUse || alive || unverified) {
    throw new UnsafeCleanupError(message);
  }

  return { unverified };
}
