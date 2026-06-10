import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createGrove } from '../src/index.js';
import { setupRepo } from './helpers/git-repo.js';
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';

describe('Pool Core (Cluster A)', () => {
  let tmpDirs: string[] = [];

  beforeEach(() => {
    tmpDirs = [];
  });

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('acquire returns worktree path with detached HEAD', async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const wtPath = await grove.acquire();

    expect(existsSync(wtPath)).toBe(true);
    
    const { stdout } = await execa('git', ['branch', '--show-current'], { cwd: wtPath });
    expect(stdout.trim()).toBe(''); // Detached HEAD means no current branch name
  });

  it('acquire -> modify -> release -> re-acquire is clean', async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const wt1 = await grove.acquire();
    
    // Modify the slot
    await writeFile(join(wt1, 'dirty.txt'), 'dirty contents');
    
    await grove.release(wt1);

    const wt2 = await grove.acquire();
    
    // In Cluster A, re-acquiring the same slot should reset it
    expect(wt2).toBe(wt1);
    expect(existsSync(join(wt2, 'dirty.txt'))).toBe(false);
  });

  it('release works when parent cwd is elsewhere (TestRelease_DoesNotDependOnCurrentWorkingDirectory)', async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const wt = await grove.acquire();

    const originalCwd = process.cwd();
    // Change cwd to something else (tmpDir root)
    process.chdir(tmpDir);
    
    try {
      await expect(grove.release(wt)).resolves.toBeUndefined();
    } finally {
      process.chdir(originalCwd);
    }
  });
});
