import { join, basename, dirname } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { getDefaultBranch, fetchOrigin, addWorktree, resetWorktree, removeWorktree, hasRemote, isDirty } from './git/index.js';
import { withStateLock } from './lock.js';
import { readState, writeState, healState } from './state.js';
import { reserveOwner, ownerAlive, isWorktreeInUse } from './process/detect.js';
import { runHooks } from './hooks.js';
import type { GroveConfig } from './index.js';

export class Grove {
  constructor(public readonly poolDir: string, private config: GroveConfig) {}

  async acquire(): Promise<string> {
    const branch = await getDefaultBranch(this.config.repoRoot);
    
    if (await hasRemote(this.config.repoRoot, 'origin')) {
      await fetchOrigin(this.config.repoRoot);
    }

    let acquiredPath = '';
    let runPostCreate = false;

    await withStateLock(this.poolDir, async () => {
      let state = await readState(this.poolDir);
      state = await healState(state);

      for (const wt of state.worktrees) {
        if (wt.destroying || await ownerAlive(wt)) {
          continue;
        }
        if (await isWorktreeInUse(wt.path)) {
          continue;
        }
        if (await isDirty(wt.path)) {
          continue;
        }
        try {
          await resetWorktree(wt.path, branch);
        } catch {
          continue;
        }
        await reserveOwner(wt);
        await writeState(this.poolDir, state);
        acquiredPath = wt.path;
        runPostCreate = true;
        return;
      }

      const maxTrees = this.config.maxTrees || 16;
      if (state.worktrees.length >= maxTrees) {
        throw new Error(`Exhausted worktrees (max ${maxTrees})`);
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
      runPostCreate = true;
    });

    if (runPostCreate && this.config.hooks?.postCreate) {
      try {
        await runHooks(this.config.hooks.postCreate, acquiredPath);
      } catch {
        // hook failure does not fail acquire
      }
    }

    return acquiredPath;
  }

  async release(worktreePath: string): Promise<void> {
    const branch = await getDefaultBranch(this.config.repoRoot);
    try {
      await resetWorktree(worktreePath, branch);
    } catch {}

    await withStateLock(this.poolDir, async () => {
      const state = await readState(this.poolDir);
      for (const wt of state.worktrees) {
        if (wt.path === worktreePath) {
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
  async list(): Promise<{ name: string, path: string, inUse: boolean, isDirty: boolean }[]> {
    const result: { name: string, path: string, inUse: boolean, isDirty: boolean }[] = [];

    await withStateLock(this.poolDir, async () => {
      let state = await readState(this.poolDir);
      state = await healState(state);
      await writeState(this.poolDir, state);

      for (const wt of state.worktrees) {
        if (wt.destroying) continue;
        
        const inUse = await isWorktreeInUse(wt.path) || await ownerAlive(wt);
        const dirty = await isDirty(wt.path);
        
        result.push({
          name: wt.name,
          path: wt.path,
          inUse,
          isDirty: dirty
        });
      }
    });

    return result;
  }

  async destroy(worktreePath: string, options?: { force?: boolean }): Promise<void> {
    let reserved: any;

    await withStateLock(this.poolDir, async () => {
      const state = await readState(this.poolDir);
      
      const idx = state.worktrees.findIndex(wt => wt.path === worktreePath);
      const targetWt = state.worktrees[idx];
      if (!targetWt) {
        throw new Error(`worktree ${worktreePath} is not managed by treehouse`);
      }

      if (!options?.force) {
        const inUse = await isWorktreeInUse(targetWt.path) || await ownerAlive(targetWt);
        if (inUse) {
          throw new Error(`worktree ${worktreePath} is in use by an agent. Use --force to override`);
        }
      }

      targetWt.destroying = true;
      await reserveOwner(targetWt);
      reserved = { ...targetWt };
      await writeState(this.poolDir, state);
    });

    if (this.config.hooks?.preDestroy) {
      try {
        await runHooks(this.config.hooks.preDestroy, worktreePath);
      } catch {}
    }

    await withStateLock(this.poolDir, async () => {
      const state = await readState(this.poolDir);
      const idx = state.worktrees.findIndex(wt => wt.path === worktreePath);
      if (idx === -1) return;

      if (!sameDestroyReservation(state.worktrees[idx], reserved)) {
        return;
      }

      try {
        await removeWorktree(this.config.repoRoot, worktreePath);
      } catch {}
      
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
          const inUse = await isWorktreeInUse(wt.path) || await ownerAlive(wt);
          if (inUse) {
            throw new Error(`worktree ${wt.path} is in use by an agent. Use --force to override`);
          }
        }
      }

      for (const wt of state.worktrees) {
        wt.destroying = true;
        await reserveOwner(wt);
      }
      
      // deep clone array of objects
      worktrees = state.worktrees.map(wt => ({ ...wt }));
      await writeState(this.poolDir, state);
    });

    for (const wt of worktrees) {
      if (this.config.hooks?.preDestroy) {
        try {
          await runHooks(this.config.hooks.preDestroy, wt.path);
        } catch {}
      }
    }

    await withStateLock(this.poolDir, async () => {
      const state = await readState(this.poolDir);
      const remove = new Set<string>();

      for (const wt of worktrees) {
        const idx = state.worktrees.findIndex(s => s.path === wt.path);
        if (idx === -1 || !sameDestroyReservation(state.worktrees[idx], wt)) {
          continue;
        }
        remove.add(wt.path);
        
        try {
          await removeWorktree(this.config.repoRoot, wt.path);
        } catch {}
        try {
          await rm(dirname(wt.path), { recursive: true, force: true });
        } catch {}
      }

      state.worktrees = state.worktrees.filter(wt => !remove.has(wt.path));
      await writeState(this.poolDir, state);
    });
  }

  async findByPath(worktreePath: string): Promise<any | null> {
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
  return current.path === reserved.path &&
    current.destroying &&
    current.owner_pid === reserved.owner_pid &&
    current.owner_started_at === reserved.owner_started_at;
}
