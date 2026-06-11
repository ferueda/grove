import { relative, isAbsolute } from "node:path";
import { isDirty, getHeadSha } from "./git/index.js";
import { readState, healState, writeState } from "./state.js";
import { ownerAlive, findInWorktree } from "./process/detect.js";
import { withStateLock } from "./lock.js";
import type { WorktreeEntry } from "./schemas.js";
import type { WorktreeStatus, GroveLease, WorktreeStatusInfo } from "./types.js";
import type { GroveConfig } from "./index.js";

function cwdInWorktree(cwd: string, worktreePath: string): boolean {
  const rel = relative(worktreePath, cwd);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

export function entryToLease(wt: WorktreeEntry, processSafety: "verified" | "unverified", repoRoot: string): GroveLease {
  return {
    leaseId: wt.leaseId!,
    ownerId: wt.ownerId,
    slotName: wt.name,
    path: wt.path,
    repoRoot,
    branch: wt.branch,
    baseRef: wt.baseRef,
    baseSha: wt.baseSha,
    acquiredHeadSha: wt.acquiredHeadSha || "",
    currentHeadSha: wt.currentHeadSha || "",
    state: (wt.state as any) || "available",
    pendingCleanup: wt.pendingCleanup,
    processSafety,
    createdAt: (wt as any).createdAt || (wt as any).created_at || "",
    updatedAt: (wt as any).updatedAt || (wt as any).created_at || "",
  };
}

export async function listWorktrees(poolDir: string): Promise<WorktreeStatus[]> {
  const result: WorktreeStatus[] = [];

  await withStateLock(poolDir, async () => {
    let state = await readState(poolDir);
    state = await healState(state);
    await writeState(poolDir, state);

    const cwd = process.cwd();

    for (const wt of state.worktrees) {
      if (wt.destroying || wt.state === "destroying" || wt.leaseId) continue;

      let status: WorktreeStatusInfo = "available";
      const { processes } = await findInWorktree(wt.path);
      const alive = await ownerAlive(wt);

      if (alive) {
        status = "in-use";
      } else if (processes.length > 0) {
        status = "in-use";
        if (cwdInWorktree(cwd, wt.path)) {
          status = "you're here";
        }
      } else if (await isDirty(wt.path)) {
        status = "dirty";
      }

      result.push({
        name: wt.name,
        path: wt.path,
        status,
        processes,
      });
    }
  });

  return result;
}

export async function listLeases(poolDir: string, config: GroveConfig): Promise<GroveLease[]> {
  const result: GroveLease[] = [];

  await withStateLock(poolDir, async () => {
    let state = await readState(poolDir);
    state = await healState(state);

    for (const wt of state.worktrees) {
      if (!wt.leaseId) continue;
      
      const { unverified } = await findInWorktree(wt.path);
      
      try {
        wt.currentHeadSha = await getHeadSha(wt.path);
      } catch {}

      result.push(entryToLease(wt, unverified ? "unverified" : "verified", config.repoRoot));
    }
  });

  return result;
}

export async function inspectLease(leaseIdOrPath: string, poolDir: string, config: GroveConfig): Promise<GroveLease | null> {
  let wt: WorktreeEntry | undefined;

  await withStateLock(poolDir, async () => {
    let state = await readState(poolDir);
    state = await healState(state);
    wt = state.worktrees.find(w => w.leaseId === leaseIdOrPath || w.path === leaseIdOrPath);
  });

  if (!wt || !wt.leaseId) return null;

  const { unverified } = await findInWorktree(wt.path);
  
  try {
    wt.currentHeadSha = await getHeadSha(wt.path);
  } catch {}

  return entryToLease(wt, unverified ? "unverified" : "verified", config.repoRoot);
}
