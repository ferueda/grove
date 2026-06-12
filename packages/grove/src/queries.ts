import { relative, isAbsolute } from "node:path";
import { isDirty } from "./git/index.js";
import { ownerAlive, findInWorktree } from "./process/detect.js";
import { withStateLock } from "./lock.js";
import type { WorktreeStatus, WorktreeStatusInfo } from "./types.js";
import { loadPoolState, leaseForSlot, savePoolState, slotToWorktreeEntry } from "./pool-state.js";

function cwdInWorktree(cwd: string, worktreePath: string): boolean {
  const rel = relative(worktreePath, cwd);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

export async function listWorktrees(poolDir: string, repoRoot: string): Promise<WorktreeStatus[]> {
  const result: WorktreeStatus[] = [];

  await withStateLock(poolDir, async () => {
    const state = await loadPoolState(poolDir, repoRoot);
    await savePoolState(poolDir, state);
    const cwd = process.cwd();

    for (const slot of state.slots) {
      if (slot.state === "destroying") continue;
      if (leaseForSlot(state, slot.slotName)) continue;

      let status: WorktreeStatusInfo = "available";
      const { processes } = await findInWorktree(slot.path);
      const alive = await ownerAlive(slotToWorktreeEntry(slot));

      if (alive) {
        status = "in-use";
      } else if (processes.length > 0) {
        status = "in-use";
        if (cwdInWorktree(cwd, slot.path)) {
          status = "you're here";
        }
      } else if (await isDirty(slot.path)) {
        status = "dirty";
      }

      result.push({
        name: slot.slotName,
        path: slot.path,
        status,
        processes,
      });
    }
  });

  return result;
}
