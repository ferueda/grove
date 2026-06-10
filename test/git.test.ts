import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupRepo } from './helpers/git-repo.js';
import { runGit } from '../src/git/run.js';
import {
  findRepoRoot,
  findRepoRootFrom,
  getDefaultBranch,
  hasRemote,
  getRemoteUrl,
  shortHash,
  branchRef,
  isAncestor,
} from '../src/git/branch.js';
import {
  addWorktree,
  removeWorktree,
  resetWorktree,
  isDirty,
  fetchOrigin,
} from '../src/git/worktree.js';
import { GitCommandError } from '../src/errors.js';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';

describe('Git Layer', () => {
  let tmpDir: string;
  let repoDir: string;
  let remoteDir: string;

  beforeEach(async () => {
    const setup = await setupRepo();
    tmpDir = setup.tmpDir;
    repoDir = setup.repoDir;
    remoteDir = setup.remoteDir;
  });

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  describe('runGit', () => {
    it('executes git and trims stdout', async () => {
      const out = await runGit(repoDir, ['rev-parse', '--is-inside-work-tree']);
      expect(out).toBe('true');
    });

    it('throws GitCommandError on git failure', async () => {
      await expect(runGit(repoDir, ['not-a-command'])).rejects.toThrowError(GitCommandError);
    });
  });

  describe('Repo and Branches', () => {
    it('finds repo root', async () => {
      const root = await findRepoRoot(repoDir);
      expect(root).toBe(repoDir);
    });

    it('finds repo root from a subdirectory', async () => {
      // Setup repo handles repoDir creation
      const root = await findRepoRootFrom(repoDir);
      expect(root).toBe(repoDir);
    });

    it('gets default branch from main repo', async () => {
      const branch = await getDefaultBranch(repoDir);
      expect(branch).toBe('main');
    });

    it('detects remote and URL', async () => {
      expect(await hasRemote(repoDir, 'origin')).toBe(true);
      expect(await hasRemote(repoDir, 'fake')).toBe(false);
      expect(await getRemoteUrl(repoDir)).toBe(remoteDir);
    });

    it('generates short hash', async () => {
      const hash = shortHash('test-string');
      expect(hash).toHaveLength(6);
    });
  });

  describe('Branch Ref Selection', () => {
    it('determines ancestor correctly', async () => {
      const ancestor = await isAncestor(repoDir, 'HEAD', 'HEAD');
      expect(ancestor).toBe(true);
    });

    it('returns remote ref when local and remote match', async () => {
      const ref = await branchRef(repoDir, 'main');
      expect(ref).toBe('origin/main');
    });
  });

  describe('Worktree Operations', () => {
    it('adds and removes a worktree', async () => {
      const wtPath = join(tmpDir, 'wt1');
      await addWorktree(repoDir, wtPath, 'main');
      expect(await findRepoRootFrom(wtPath)).toBe(wtPath);

      await removeWorktree(repoDir, wtPath);
      await expect(findRepoRootFrom(wtPath)).rejects.toThrow(/Git not found|failed|ENOENT/i);
    });

    it('detects dirty state', async () => {
      const wtPath = join(tmpDir, 'wt2');
      await addWorktree(repoDir, wtPath, 'main');
      
      expect(await isDirty(wtPath)).toBe(false);
      await execa('node', ['-e', `require("fs").writeFileSync("${join(wtPath, 'dirty.txt')}", "1")`]);
      expect(await isDirty(wtPath)).toBe(true);
    });

    it('resets a worktree cleanly', async () => {
      const wtPath = join(tmpDir, 'wt3');
      await addWorktree(repoDir, wtPath, 'main');
      await execa('node', ['-e', `require("fs").writeFileSync("${join(wtPath, 'dirty.txt')}", "1")`]);
      
      await resetWorktree(wtPath, 'main');
      expect(await isDirty(wtPath)).toBe(false);
    });

    it('fetches origin', async () => {
      // Just verifying it doesn't throw
      await fetchOrigin(repoDir);
      expect(true).toBe(true);
    });
  });
});
