import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createGrove } from '../src/index.js';
import { setupRepo } from './helpers/git-repo.js';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';

describe('Grove Vertical Smoke', () => {
  let tmpDirs: string[] = [];

  beforeEach(() => {
    tmpDirs = [];
  });

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('wires createGrove -> acquire -> release cleanly', async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });

    const wt1 = await grove.acquire();
    expect(existsSync(wt1)).toBe(true);

    await grove.release(wt1);

    const wt2 = await grove.acquire();
    expect(wt2).toBe(wt1);
  });
});
