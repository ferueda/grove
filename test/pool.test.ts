import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createGrove } from '../src/index.js';
import { setupRepo } from './helpers/git-repo.js';
import { existsSync } from 'node:fs';
import { rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';

describe('Pool Core (Cluster A & B)', () => {
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
    
    await writeFile(join(wt1, 'dirty.txt'), 'dirty contents');
    await grove.release(wt1);

    const wt2 = await grove.acquire();
    
    expect(wt2).toBe(wt1);
    expect(existsSync(join(wt2, 'dirty.txt'))).toBe(false);
  });

  it('release works when parent cwd is elsewhere', async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const wt = await grove.acquire();

    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    
    try {
      await expect(grove.release(wt)).resolves.toBeUndefined();
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('runs postCreate hook in worktree', async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({
      repoRoot: repoDir,
      groveRoot: groveDir,
      hooks: {
        postCreate: [
          process.platform === 'win32' ? 'echo hello > sentinel.txt' : 'echo "hello" > sentinel.txt'
        ]
      }
    });

    const wt = await grove.acquire();
    expect(existsSync(join(wt, 'sentinel.txt'))).toBe(true);
    const content = await readFile(join(wt, 'sentinel.txt'), 'utf8');
    expect(content.trim()).toBe('hello');
  });

  it('hook failure does not fail acquire', async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({
      repoRoot: repoDir,
      groveRoot: groveDir,
      hooks: {
        postCreate: ['exit 1']
      }
    });

    const wt = await grove.acquire();
    expect(existsSync(wt)).toBe(true);
  });

  it('runs postCreate hook after releasing state lock', async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({
      repoRoot: repoDir,
      groveRoot: groveDir,
      hooks: {
        postCreate: [
          `node \${GROVE_PROJECT_ROOT}/test/helpers/hook-probe.mjs check-lock`
        ]
      }
    });

    process.env['GROVE_POOL_DIR'] = grove.poolDir;
    process.env['GROVE_OUT_DIR'] = tmpDir;
    process.env['GROVE_PROJECT_ROOT'] = process.cwd();

    await grove.acquire();

    const status = await readFile(join(tmpDir, 'lock-status.txt'), 'utf8');
    expect(status).toBe('UNLOCKED');

    delete process.env['GROVE_POOL_DIR'];
    delete process.env['GROVE_OUT_DIR'];
    delete process.env['GROVE_PROJECT_ROOT'];
  });

  it('does not reuse worktree reserved by postCreate hook', async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({
      repoRoot: repoDir,
      groveRoot: groveDir,
      hooks: {
        postCreate: [
          process.platform === 'win32' ? 'timeout 1' : 'sleep 0.5'
        ]
      }
    });

    const p1 = grove.acquire();
    await new Promise(r => setTimeout(r, 100));
    const p2 = grove.acquire();

    const [wt1, wt2] = await Promise.all([p1, p2]);
    expect(wt1).not.toBe(wt2);
  });
});
