import type { GroveLeaseRecord, GroveSlot } from "../schemas.js";
import { UnsafeCleanupError } from "../errors.js";
import { slotToWorktreeEntry } from "../pool-state.js";
import { isWorktreeInUse, ownerAlive } from "./detect.js";

export type WorktreeCleanupSafetyOptions = {
  force?: boolean | undefined;
  ignoreOwnerReservation?: boolean | undefined;
  message?: string | undefined;
};

export async function assertWorktreeSafeForCleanup(
  slotPath: string,
  slot: GroveSlot,
  lease: GroveLeaseRecord | undefined,
  options?: boolean | WorktreeCleanupSafetyOptions,
  legacyMessage?: string,
): Promise<{ unverified: boolean }> {
  const normalized: WorktreeCleanupSafetyOptions =
    typeof options === "boolean" ? { force: options } : (options ?? {});
  const message =
    normalized.message ??
    legacyMessage ??
    "Unsafe cleanup: active processes or unverified safety. Use force: true.";

  const { inUse, unverified } = await isWorktreeInUse(slotPath);
  if (normalized.force) {
    return { unverified };
  }

  const alive = normalized.ignoreOwnerReservation
    ? false
    : await ownerAlive(slotToWorktreeEntry(slot, lease));
  if (inUse || alive || unverified) {
    throw new UnsafeCleanupError(message);
  }

  return { unverified };
}
