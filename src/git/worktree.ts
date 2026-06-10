import { runGit } from './run.js';
import { branchRef } from './branch.js';

export async function addWorktree(repoRoot: string, path: string, branch: string): Promise<void> {
  const ref = await branchRef(repoRoot, branch);
  await runGit(repoRoot, ['worktree', 'add', '--detach', path, ref]);
}

export async function removeWorktree(repoRoot: string, path: string): Promise<void> {
  await runGit(repoRoot, ['worktree', 'remove', '--force', path]);
}

export async function resetWorktree(path: string, branch: string): Promise<void> {
  let repoRoot = path;
  try {
    repoRoot = await runGit(path, ['rev-parse', '--show-toplevel']);
  } catch {}
  const ref = await branchRef(repoRoot, branch);
  await runGit(path, ['checkout', '--detach', '--force', ref]);
  await runGit(path, ['reset', '--hard', ref]);
  await runGit(path, ['clean', '-fd']);
}

export async function detachWorktree(path: string): Promise<void> {
  await runGit(path, ['checkout', '--detach']);
}

export async function isDirty(path: string): Promise<boolean> {
  const status = await runGit(path, ['status', '--porcelain']);
  return status.trim().length > 0;
}

export async function fetchOrigin(repoRoot: string): Promise<void> {
  try {
    const remotes = await runGit(repoRoot, ['remote']);
    if (remotes.split('\n').map(r => r.trim()).includes('origin')) {
      await runGit(repoRoot, ['fetch', 'origin']);
    }
  } catch {
    // ignore
  }
}
