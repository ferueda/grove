import { findInWorktree, type ProcessInfo } from './detect.js';
import { execa } from 'execa';

export async function parentPID(pid: number): Promise<number> {
  if (process.platform === 'linux') {
    try {
      const { readFile } = await import('node:fs/promises');
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      const lastCloseParen = stat.lastIndexOf(')');
      if (lastCloseParen !== -1) {
        const postParen = stat.substring(lastCloseParen + 2);
        const fields = postParen.split(' ');
        const ppid = parseInt(fields[1] || '', 10);
        if (!Number.isNaN(ppid)) {
          return ppid;
        }
      }
    } catch {
      return 0;
    }
  } else if (process.platform === 'darwin') {
    try {
      const { stdout } = await execa('ps', ['-p', String(pid), '-o', 'ppid=']);
      const ppid = parseInt(stdout.trim(), 10);
      if (!Number.isNaN(ppid)) {
        return ppid;
      }
    } catch {
      return 0;
    }
  }
  return 0;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function anyAlive(pids: number[]): boolean {
  return pids.some(pid => isAlive(pid));
}

async function terminate(pids: number[], gracePeriodMs: number): Promise<void> {
  for (const pid of pids) {
    if (isAlive(pid)) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {}
    }
  }

  const deadline = Date.now() + gracePeriodMs;
  while (Date.now() < deadline) {
    if (!anyAlive(pids)) {
      return;
    }
    await new Promise(r => setTimeout(r, 50));
  }

  for (const pid of pids) {
    if (isAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
  }
}

export async function filterProtectedProcesses(procs: ProcessInfo[], currentPID: number): Promise<ProcessInfo[]> {
  const protectedPids = new Set<number>([currentPID]);
  
  let pid = currentPID;
  while (pid > 0) {
    const parent = await parentPID(pid);
    if (parent <= 0) break;
    if (protectedPids.has(parent)) break;
    protectedPids.add(parent);
    pid = parent;
  }

  return procs.filter(p => !protectedPids.has(p.PID));
}

export async function terminateWorktreeProcesses(worktreePath: string, gracePeriodMs: number): Promise<ProcessInfo[]> {
  const procs = await findInWorktree(worktreePath);
  const targetProcs = await filterProtectedProcesses(procs, process.pid);
  
  if (targetProcs.length === 0) {
    return [];
  }

  const pids = targetProcs.map(p => p.PID);
  await terminate(pids, gracePeriodMs);
  return targetProcs;
}
