import { join, basename, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { getDefaultBranch, fetchOrigin, addWorktree, resetWorktree, hasRemote, isDirty } from './git/index.js';
import { withStateLock } from './lock.js';
import { readState, writeState, healState } from './state.js';
import { reserveOwner, ownerAlive, isWorktreeInUse } from './process/detect.js';
import type { GroveConfig } from './index.js';

export class Grove {
  constructor(public readonly poolDir: string, private config: GroveConfig) {}

  async acquire(): Promise<string> {
    const branch = await getDefaultBranch(this.config.repoRoot);
    
    if (await hasRemote(this.config.repoRoot, 'origin')) {
      await fetchOrigin(this.config.repoRoot);
    }

    return await withStateLock(this.poolDir, async () => {
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
        return wt.path;
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

      return wtPath;
    });
  }

  async release(worktreePath: string): Promise<void> {
    const branch = await getDefaultBranch(this.config.repoRoot);
    
    await resetWorktree(worktreePath, branch);

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
