import { createHash } from 'node:crypto';
import { runGit } from './run.js';

export async function findRepoRoot(cwd?: string): Promise<string> {
  return runGit(cwd, ['rev-parse', '--show-toplevel']);
}

export async function findRepoRootFrom(cwd: string): Promise<string> {
  return findRepoRoot(cwd);
}

export async function getDefaultBranch(repoRoot: string): Promise<string> {
  try {
    const out = await runGit(repoRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
    return out.replace('refs/remotes/origin/', '');
  } catch {
    // ignore
  }

  try {
    // Need to query the common dir's HEAD if we are in a worktree
    const commonDir = await runGit(repoRoot, ['rev-parse', '--git-common-dir']);
    const out = await runGit(repoRoot, ['--git-dir=' + commonDir, 'symbolic-ref', 'HEAD']);
    return out.replace('refs/heads/', '');
  } catch {
    // ignore
  }

  try {
    const out = await runGit(repoRoot, ['config', 'init.defaultBranch']);
    if (out) return out;
  } catch {
    // ignore
  }

  return 'main';
}

export async function hasRemote(repoRoot: string, name: string): Promise<boolean> {
  try {
    const out = await runGit(repoRoot, ['remote']);
    return out.split('\n').map(r => r.trim()).includes(name);
  } catch {
    return false;
  }
}

export async function getRemoteUrl(repoRoot: string): Promise<string> {
  return runGit(repoRoot, ['remote', 'get-url', 'origin']);
}

export function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').substring(0, 6);
}

export async function isAncestor(repoRoot: string, a: string, b: string): Promise<boolean> {
  try {
    await runGit(repoRoot, ['merge-base', '--is-ancestor', a, b]);
    return true; // exit code 0 means true
  } catch {
    return false; // exit code 1 means false
  }
}

export async function branchRef(repoRoot: string, branch: string): Promise<string> {
  const remote = `origin/${branch}`;
  
  let localExists = false;
  try {
    await runGit(repoRoot, ['rev-parse', '--verify', branch]);
    localExists = true;
  } catch {}

  let remoteExists = false;
  try {
    await runGit(repoRoot, ['rev-parse', '--verify', remote]);
    remoteExists = true;
  } catch {}

  if (localExists && remoteExists) {
    if (await isAncestor(repoRoot, branch, remote)) {
      return remote; // remote is ahead or equal
    }
    if (await isAncestor(repoRoot, remote, branch)) {
      return branch; // local is ahead
    }
    return remote; // diverged, prefer remote
  }

  if (localExists) return branch;
  if (remoteExists) return remote;
  
  return branch; // fallback
}
