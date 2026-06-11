import { join, basename, dirname, isAbsolute, relative } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import {
  getDefaultBranch,
  addWorktree,
  resetWorktree,
  removeWorktree,
  isDirty,
  fetchOrigin,
} from "./git/index.js";
import { withStateLock } from "./lock.js";
import { readState, writeState, healState } from "./state.js";
import { reserveOwner, ownerAlive, isWorktreeInUse, findInWorktree } from "./process/detect.js";
import { runHooks } from "./hooks.js";
import type { GroveConfig } from "./index.js";
import type { WorktreeEntry } from "./schemas.js";
import {
  GroveExhaustedError,
  WorktreeDestroyingError,
  WorktreeInUseError,
  WorktreeNotManagedError,
} from "./errors.js";

export type WorktreeStatusInfo = "available" | "dirty" | "in-use" | "you're here";

export interface AcquiredSlot {
  readonly path: string;
  readonly name: string;
}

export interface WorktreeStatus {
  name: string;
  path: string;
  status: WorktreeStatusInfo;
  processes: { PID: number; Name?: string }[];
}

export class Grove {
  constructor(
    public readonly poolDir: string,
    private config: GroveConfig,
  ) {}

  async acquire(): Promise<AcquiredSlot> {
    const branch = await getDefaultBranch(this.config.repoRoot);

    if (this.config.fetchOnAcquire !== false) {
      await fetchOrigin(this.config.repoRoot);
    }

    let acquiredPath = "";
    let acquiredName = "";
    let runPostCreate = false;

    await withStateLock(this.poolDir, async () => {
      let state = await readState(this.poolDir);
      state = await healState(state);

      for (const wt of state.worktrees) {
        if (wt.destroying) continue;
        const inUse = (await ownerAlive(wt)) || (await isWorktreeInUse(wt.path));
        if (inUse) continue;

        const dirty = await isDirty(wt.path);
        if (dirty) {
          continue; // Do not destructively reset dirty worktrees
        }
        try {
          await resetWorktree(wt.path, branch); // Always reset clean worktrees to default branch
        } catch {
          continue;
        }
        await reserveOwner(wt);
        await writeState(this.poolDir, state);
        acquiredPath = wt.path;
        acquiredName = wt.name;
        runPostCreate = true;
        return;
      }

      const maxTrees = this.config.maxTrees || 16;
      if (state.worktrees.length >= maxTrees) {
        throw new GroveExhaustedError(`Exhausted worktrees (max ${maxTrees})`);
      }

      const nextId = this.nextName(state);
      const repoName = basename(this.config.repoRoot);
      const wtPath = join(this.poolDir, nextId, repoName);

      await mkdir(dirname(wtPath), { recursive: true });
      await addWorktree(this.config.repoRoot, wtPath, branch);

      const entry = {
        name: nextId,
        path: wtPath,
        created_at: new Date().toISOString(),
      };
      await reserveOwner(entry);

      state.worktrees.push(entry);
      await writeState(this.poolDir, state);

      acquiredPath = wtPath;
      acquiredName = nextId;
      runPostCreate = true;
    });

    if (runPostCreate && this.config.hooks?.postCreate) {
      try {
        await runHooks(this.config.hooks.postCreate, acquiredPath, {
          stdout: process.stdout,
          stderr: process.stderr,
        });
      } catch {
        // hook failure does not fail acquire
      }
    }

    return { path: acquiredPath, name: acquiredName };
  }

  async release(worktreePath: string): Promise<void> {
    const branch = await getDefaultBranch(this.config.repoRoot);

    await withStateLock(this.poolDir, async () => {
      const state = await readState(this.poolDir);
      for (const wt of state.worktrees) {
        if (wt.path === worktreePath && wt.destroying) {
          throw new WorktreeDestroyingError(`worktree ${worktreePath} is being destroyed`);
        }
      }
    });

    await resetWorktree(worktreePath, branch);

    await withStateLock(this.poolDir, async () => {
      const state = await readState(this.poolDir);
      for (const wt of state.worktrees) {
        if (wt.path === worktreePath) {
          if (wt.destroying) {
            throw new WorktreeDestroyingError(`worktree ${worktreePath} is being destroyed`);
          }
          wt.owner_pid = undefined;
          wt.owner_started_at = undefined;
          break;
        }
      }
      await writeState(this.poolDir, state);
    });
  }

  private nextName(state: any): string {
    let max = 0;
    for (const wt of state.worktrees) {
      const n = parseInt(wt.name, 10);
      if (!isNaN(n) && n > max) {
        max = n;
      }
    }
    return (max + 1).toString();
  }

  async list(): Promise<WorktreeStatus[]> {
    const result: WorktreeStatus[] = [];

    await withStateLock(this.poolDir, async () => {
      let state = await readState(this.poolDir);
      state = await healState(state);
      await writeState(this.poolDir, state);

      const cwd = process.cwd();

      for (const wt of state.worktrees) {
        if (wt.destroying) continue;

        let status: WorktreeStatusInfo = "available";
        const processes = await findInWorktree(wt.path);

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

  async destroy(worktreePath: string, options?: { force?: boolean }): Promise<void> {
    let reserved: any;

    await withStateLock(this.poolDir, async () => {
      const state = await readState(this.poolDir);

      const idx = state.worktrees.findIndex((wt) => wt.path === worktreePath);
      const targetWt = state.worktrees[idx];
      if (!targetWt) {
        throw new WorktreeNotManagedError(`worktree ${worktreePath} is not managed by grove`);
      }

      if (!options?.force) {
        const inUse = (await ownerAlive(targetWt)) || (await isWorktreeInUse(targetWt.path));
        if (inUse) {
          throw new WorktreeInUseError(
            `worktree ${worktreePath} is in use by an agent. Use --force to override`,
          );
        }
      }

      targetWt.destroying = true;
      await reserveOwner(targetWt);
      reserved = { ...targetWt };
      await writeState(this.poolDir, state);
    });

    if (this.config.hooks?.preDestroy) {
      try {
        await runHooks(this.config.hooks.preDestroy, worktreePath, {
          stdout: process.stdout,
          stderr: process.stderr,
        });
      } catch {}
    }

    await withStateLock(this.poolDir, async () => {
      const state = await readState(this.poolDir);
      const idx = state.worktrees.findIndex((wt) => wt.path === worktreePath);
      if (idx === -1) return;

      if (!sameDestroyReservation(state.worktrees[idx], reserved)) {
        return;
      }

      try {
        await removeWorktree(this.config.repoRoot, worktreePath);
      } catch {}

      assertPathWithinPool(this.poolDir, worktreePath);
      try {
        await rm(dirname(worktreePath), { recursive: true, force: true });
      } catch {}

      state.worktrees.splice(idx, 1);
      await writeState(this.poolDir, state);
    });
  }

  async destroyAll(options?: { force?: boolean }): Promise<void> {
    let worktrees: any[] = [];

    await withStateLock(this.poolDir, async () => {
      const state = await readState(this.poolDir);

      if (!options?.force) {
        for (const wt of state.worktrees) {
          const inUse = (await ownerAlive(wt)) || (await isWorktreeInUse(wt.path));
          if (inUse) {
            throw new WorktreeInUseError(
              `worktree ${wt.path} is in use by an agent. Use --force to override`,
            );
          }
        }
      }

      for (const wt of state.worktrees) {
        wt.destroying = true;
        await reserveOwner(wt);
      }

      worktrees = state.worktrees.map((wt) => ({ ...wt }));
      await writeState(this.poolDir, state);
    });

    for (const wt of worktrees) {
      if (this.config.hooks?.preDestroy) {
        try {
          await runHooks(this.config.hooks.preDestroy, wt.path, {
            stdout: process.stdout,
            stderr: process.stderr,
          });
        } catch {}
      }
    }

    await withStateLock(this.poolDir, async () => {
      const state = await readState(this.poolDir);
      const remove = new Set<string>();

      for (const wt of worktrees) {
        const idx = state.worktrees.findIndex((s) => s.path === wt.path);
        if (idx === -1 || !sameDestroyReservation(state.worktrees[idx], wt)) {
          continue;
        }
        remove.add(wt.path);

        try {
          await removeWorktree(this.config.repoRoot, wt.path);
        } catch {}
        
        assertPathWithinPool(this.poolDir, wt.path);
        try {
          await rm(dirname(wt.path), { recursive: true, force: true });
        } catch {}
      }

      state.worktrees = state.worktrees.filter((wt) => !remove.has(wt.path));
      await writeState(this.poolDir, state);
    });
  }

  async findByPath(worktreePath: string): Promise<WorktreeEntry | null> {
    const state = await readState(this.poolDir);
    for (const wt of state.worktrees) {
      if (wt.path === worktreePath) {
        return wt;
      }
    }
    return null;
  }
}

function sameDestroyReservation(current: any, reserved: any): boolean {
  return (
    current.path === reserved.path &&
    current.destroying &&
    current.owner_pid === reserved.owner_pid &&
    current.owner_started_at === reserved.owner_started_at
  );
}

function cwdInWorktree(cwd: string, worktreePath: string): boolean {
  const rel = relative(worktreePath, cwd);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

function assertPathWithinPool(poolDir: string, targetPath: string): void {
  const rel = relative(poolDir, targetPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Security violation: target path is outside the pool boundary");
  }
}
