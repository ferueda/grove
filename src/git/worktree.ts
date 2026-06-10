import { runGit } from './run.js';

export async function addWorktree(repoRoot: string, path: string, branch: string): Promise<void> {
  await runGit(repoRoot, ['worktree', 'add', '--detach', path, branch]);
}

export async function removeWorktree(repoRoot: string, path: string): Promise<void> {
  await runGit(repoRoot, ['worktree', 'remove', '--force', path]);
}

export async function resetWorktree(path: string, branch: string): Promise<void> {
  await runGit(path, ['checkout', '--detach', '--force', branch]);
  await runGit(path, ['reset', '--hard']);
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
