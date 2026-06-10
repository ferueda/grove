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
  it('lists all pools correctly', async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const wt1 = await grove.acquire();
    const wt2 = await grove.acquire();

    await grove.release(wt1);
    await grove.release(wt2);

    const list = await grove.list();
    expect(list.length).toBe(2);
    expect(list.map(l => l.path).sort()).toEqual([wt1, wt2].sort());
  });

  it('marks dirty slots correctly in list', async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const wt1 = await grove.acquire();
    const wt2 = await grove.acquire();

    await writeFile(join(wt1, 'dirty.txt'), 'dirty');

    const list = await grove.list();
    const l1 = list.find(l => l.path === wt1);
    const l2 = list.find(l => l.path === wt2);

    expect(l1?.isDirty).toBe(true);
    expect(l2?.isDirty).toBe(false);
  });

  it('marks in-use slots correctly in list', async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const wt1 = await grove.acquire();
    
    // wt1 is in-use because we haven't released it, and ownerAlive will be true 
    // because this process (the owner) is still alive!
    const list = await grove.list();
    const l1 = list.find(l => l.path === wt1);
    expect(l1?.inUse).toBe(true);
  });

  it('throws when maxTrees reached', async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir, maxTrees: 2 });
    
    await grove.acquire();
    await grove.acquire();

    await expect(grove.acquire()).rejects.toThrow(/Exhausted worktrees/);
  });

  it('destroy kills owners, removes worktrees, deletes pool dir', async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const wt = await grove.acquire();
    
    expect(existsSync(wt)).toBe(true);

    await grove.destroy();
    expect(existsSync(grove.poolDir)).toBe(false);
  });

  it('runs preDestroy hook before deletion', async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ 
      repoRoot: repoDir, 
      groveRoot: groveDir,
      hooks: {
        preDestroy: [
          process.platform === 'win32' ? 'echo hello > %GROVE_OUT_DIR%/sentinel.txt' : 'echo "hello" > $GROVE_OUT_DIR/sentinel.txt'
        ]
      }
    });
    
    process.env['GROVE_OUT_DIR'] = tmpDir;

    await grove.acquire();
    await grove.destroy();

    const content = await readFile(join(tmpDir, 'sentinel.txt'), 'utf8');
    expect(content.trim()).toBe('hello');

    delete process.env['GROVE_OUT_DIR'];
  });

  describe('release robustness', () => {
    it('release safely ignores missing state', async () => {
      const { repoDir, tmpDir, groveDir } = await setupRepo();
      tmpDirs.push(tmpDir);

      const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
      const wt = await grove.acquire();

      // delete state file
      await rm(join(groveDir, 'grove-state.json'), { force: true });
      
      await expect(grove.release(wt)).resolves.toBeUndefined();
    });

    it('release safely ignores missing worktree', async () => {
      const { repoDir, tmpDir, groveDir } = await setupRepo();
      tmpDirs.push(tmpDir);

      const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
      const wt = await grove.acquire();

      await rm(wt, { recursive: true, force: true });
      
      await expect(grove.release(wt)).resolves.toBeUndefined();
    });
  });
});
