import { realpath, readdir, readlink, stat } from 'node:fs/promises';
import { relative } from 'node:path';
import { execa } from 'execa';
import type { WorktreeEntry } from '../schemas.js';

export interface ProcessInfo {
  PID: number;
  Name?: string;
}

export async function startedAt(pid: number): Promise<number | null> {
  try {
    if (process.platform === 'linux') {
      const s = await stat(`/proc/${pid}`);
      return s.mtimeMs;
    } else if (process.platform === 'darwin') {
      const { stdout } = await execa('ps', ['-p', String(pid), '-o', 'lstart=']);
      const parsed = Date.parse(stdout.trim());
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function reserveOwner(entry: WorktreeEntry): Promise<void> {
  entry.owner_pid = process.pid;
  const start = await startedAt(process.pid);
  if (start !== null) {
    entry.owner_started_at = start;
  }
}

export async function ownerAlive(entry: WorktreeEntry): Promise<boolean> {
  if (entry.owner_pid === undefined) return false;
  
  // Phase 2 stub mock PID handling
  if (entry.owner_pid === -1) return false;

  // Quick PID existence check
  try {
    process.kill(entry.owner_pid, 0);
  } catch {
    return false;
  }

  // Exact process match check
  if (entry.owner_started_at !== undefined) {
    const start = await startedAt(entry.owner_pid);
    if (start === null || start !== entry.owner_started_at) {
      return false;
    }
  }

  return true;
}

async function resolvePathSafe(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return p;
  }
}

export async function findInWorktree(worktreePath: string): Promise<ProcessInfo[]> {
  const absWorktree = await resolvePathSafe(worktreePath);
  const result: ProcessInfo[] = [];

  if (process.platform === 'linux') {
    let procs: string[] = [];
    try {
      procs = await readdir('/proc');
    } catch {
      return [];
    }
    
    for (const p of procs) {
      if (!/^\d+$/.test(p)) continue;
      try {
        const cwd = await readlink(`/proc/${p}/cwd`);
        const absCwd = await resolvePathSafe(cwd);
        const rel = relative(absWorktree, absCwd);
        if (!rel.startsWith('..') && rel !== '..') {
          result.push({ PID: parseInt(p, 10) });
        }
      } catch {
        continue;
      }
    }
  } else if (process.platform === 'darwin') {
    try {
      const { stdout } = await execa('lsof', ['-F', 'pn', '-d', 'cwd'], { reject: false });
      const lines = stdout.split('\n');
      let currentPid = -1;
      for (const line of lines) {
        if (line.startsWith('p')) {
          currentPid = parseInt(line.slice(1), 10);
        } else if (line.startsWith('n') && currentPid !== -1) {
          const cwd = line.slice(1);
          const absCwd = await resolvePathSafe(cwd);
          const rel = relative(absWorktree, absCwd);
          if (!rel.startsWith('..') && rel !== '..') {
            result.push({ PID: currentPid });
          }
        }
      }
    } catch {
      // lsof returns error code if it finds no files or encounters permission errors.
    }
  }

  return result;
}

export async function isWorktreeInUse(worktreePath: string): Promise<boolean> {
  const procs = await findInWorktree(worktreePath);
  return procs.length > 0;
}
