import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createGrove } from "../src/index.js";
import { setupRepo } from "./helpers/git-repo.js";
import { existsSync } from "node:fs";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

describe("Grove Vertical Smoke", () => {
  let tmpDirs: string[] = [];

  beforeEach(() => {
    tmpDirs = [];
  });

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("wires createGrove -> acquire -> release cleanly", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });

    const wt1 = await grove.acquire();
    expect(existsSync(wt1)).toBe(true);

    await grove.release(wt1);

    const wt2 = await grove.acquire();
    expect(wt2).toBe(wt1);
  });

  it("surfaces INVALID_GROVE_STATE on invalid state file during acquire", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveDir: groveDir });

    await mkdir(groveDir, { recursive: true });
    await writeFile(join(groveDir, "grove-state.json"), "invalid json");

    await expect(grove.acquire()).rejects.toThrow("Invalid JSON format");
  });

  it("verifies GroveExhaustedError code is GROVE_EXHAUSTED", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir, maxTrees: 1 });
    await grove.acquire();

    let err: any;
    try {
      await grove.acquire();
    } catch (e) {
      err = e;
    }
    expect(err.code).toBe("GROVE_EXHAUSTED");
  });

  it("supports fully programmatic createGrove without defaults", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({
      repoRoot: repoDir,
      maxTrees: 2,
      groveRoot: groveDir,
      hooks: { postCreate: ['echo "hook"'] },
    });

    await grove.acquire();
    await grove.acquire();
    await expect(grove.acquire()).rejects.toThrow(/Exhausted worktrees/);
  });

  it("release() hard-resets a dirty worktree", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const wt = await grove.acquire();

    await writeFile(join(wt, "dirty.txt"), "dirty content");

    await grove.release(wt);
    const wt2 = await grove.acquire();
    expect(wt2).toBe(wt);
    expect(existsSync(join(wt2, "dirty.txt"))).toBe(false);
  });

  it("heal drops state entry when worktree directory is deleted from disk", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const wt = await grove.acquire();
    await grove.release(wt);

    await rm(wt, { recursive: true, force: true });

    const list = await grove.list();
    expect(list.length).toBe(0);
  });

  it("handles parallel acquire() from child processes without double-booking", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const scriptPath = join(process.cwd(), "test", "helpers", "parallel-acquire.mjs");

    const execa = (await import("execa")).execa;

    const children = Array.from({ length: 5 }).map(() => {
      const child = execa("node", [scriptPath], {
        env: {
          ...process.env,
          GROVE_TEST_REPO: repoDir,
          GROVE_TEST_DIR: groveDir,
        },
      });
      child.catch(() => {});
      return child;
    });

    const paths: string[] = [];
    await Promise.all(
      children.map((child) => {
        return new Promise<void>((resolve) => {
          child.stdout!.on("data", (data) => {
            paths.push(data.toString().trim());
            resolve();
          });
        });
      }),
    );

    // Now all 5 have acquired and printed their paths
    const uniquePaths = new Set(paths);
    expect(uniquePaths.size).toBe(5);

    // Cleanup: kill them
    children.forEach((c) => c.kill());
  });
});
