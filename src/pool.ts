import { join, basename, dirname } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { getDefaultBranch, fetchOrigin, addWorktree, resetWorktree, removeWorktree, hasRemote, isDirty } from './git/index.js';
import { withStateLock } from './lock.js';
import { readState, writeState, healState } from './state.js';
import { reserveOwner, ownerAlive, isWorktreeInUse } from './process/detect.js';
import { terminateWorktreeOwner } from './process/terminate.js';
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
    let state = await readState(this.poolDir);
    state = await healState(state);

    const result = [];
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
    return result;
  }

  async destroy(): Promise<void> {
    let state = await readState(this.poolDir);
    
    await withStateLock(this.poolDir, async () => {
      state = await readState(this.poolDir);
      for (const wt of state.worktrees) {
        wt.destroying = true;
      }
      await writeState(this.poolDir, state);
    });

    for (const wt of state.worktrees) {
      try {
        await terminateWorktreeOwner(wt);
      } catch {}

      if (this.config.hooks?.preDestroy) {
        try {
          await runHooks(this.config.hooks.preDestroy, wt.path);
        } catch {}
      }

      try {
        await removeWorktree(this.config.repoRoot, wt.path);
      } catch {}
    }

    try {
      await rm(this.poolDir, { recursive: true, force: true });
    } catch {}
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
