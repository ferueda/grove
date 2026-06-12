import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestGrove } from "./helpers/test-grove.js";
import { setupRepo } from "./helpers/git-repo.js";
import { existsSync } from "node:fs";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

describe("Grove lease-first smoke", () => {
  let tmpDirs: string[] = [];

  beforeEach(() => {
    tmpDirs = [];
  });

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("wires createGrove -> acquire -> release preserve cleanly", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "smoke-lease",
      mode: "branch",
      branch: "smoke-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });
    expect(existsSync(lease.path)).toBe(true);

    await grove.release(lease.leaseId, { cleanup: "preserve" });

    const again = await grove.acquire({
      leaseId: "smoke-lease",
      mode: "branch",
      branch: "smoke-branch",
      ifLeased: "return-existing",
    });
    expect(again.path).toBe(lease.path);
  });

  it("surfaces INVALID_GROVE_STATE on invalid state file during acquire", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
    await mkdir(grove.poolDir, { recursive: true });
    await writeFile(join(grove.poolDir, "grove-state.json"), "invalid json");

    await expect(
      grove.acquire({
        leaseId: "bad-state",
        mode: "detached",
        ref: "main",
      }),
    ).rejects.toThrow("Invalid JSON format");
  });

  it("verifies POOL_EXHAUSTED when maxTrees is reached", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir, maxTrees: 1 });
    await grove.acquire({ leaseId: "lease-1", mode: "detached", ref: "main" });

    let err: any;
    try {
      await grove.acquire({ leaseId: "lease-2", mode: "detached", ref: "main" });
    } catch (e) {
      err = e;
    }
    expect(["POOL_EXHAUSTED", "GROVE_EXHAUSTED"]).toContain(err.code);
  });

  it("handles parallel lease acquire from child processes without double-booking", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const scriptPath = join(import.meta.dirname, "helpers", "parallel-acquire.mjs");
    const execa = (await import("execa")).execa;

    const children = Array.from({ length: 5 }).map((_, index) =>
      execa("node", [scriptPath, String(index)], {
        env: {
          ...process.env,
          GROVE_REPO_ROOT: repoDir,
          GROVE_GROVE_ROOT: groveDir,
        },
      }),
    );

    const results = await Promise.all(children);
    const paths = results.map((result) => result.stdout.trim());

    expect(paths).toHaveLength(5);
    expect(new Set(paths).size).toBe(5);
  });
});
