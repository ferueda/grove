import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveGroveDir } from "../src/config.js";
import { setupRepo } from "./helpers/git-repo.js";
import { rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";

describe("Config", () => {
  let tmpDirs: string[] = [];

  beforeEach(() => {
    tmpDirs = [];
  });

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("resolves empty root to ~/.grove/{poolName}", async () => {
    const { repoDir, tmpDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const poolDir = await resolveGroveDir(repoDir, "");
    const repoName = basename(repoDir);

    expect(poolDir.startsWith(join(homedir(), ".grove", repoName))).toBe(true);
  });

  it("resolves relative root to {repoDir}/{root}/.grove/{poolName}", async () => {
    const { repoDir, tmpDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const poolDir = await resolveGroveDir(repoDir, ".worktrees");
    const repoName = basename(repoDir);

    const expectedPrefix = join(repoDir, ".worktrees", ".grove", repoName);
    expect(poolDir.startsWith(expectedPrefix)).toBe(true);
  });

  it("resolves dot-slash relative root correctly", async () => {
    const { repoDir, tmpDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const poolDir = await resolveGroveDir(repoDir, "./");
    const repoName = basename(repoDir);

    const expectedPrefix = join(repoDir, ".grove", repoName);
    expect(poolDir.startsWith(expectedPrefix)).toBe(true);
  });

  it("resolves absolute root to {root}/.grove/{poolName}", async () => {
    const { repoDir, tmpDir } = await setupRepo();
    tmpDirs.push(tmpDir);
    const absRoot = join(tmpDir, "abs-root");

    const poolDir = await resolveGroveDir(repoDir, absRoot);
    const repoName = basename(repoDir);

    const expectedPrefix = join(absRoot, ".grove", repoName);
    expect(poolDir.startsWith(expectedPrefix)).toBe(true);
  });

  it("expands environment variables", async () => {
    const { repoDir, tmpDir } = await setupRepo();
    tmpDirs.push(tmpDir);
    const absRoot = join(tmpDir, "env-root");

    process.env["TEST_GROVE_ROOT"] = absRoot;
    process.env["var2"] = "sub";

    const poolDir = await resolveGroveDir(repoDir, "${TEST_GROVE_ROOT}/$var2");
    const repoName = basename(repoDir);

    const expectedPrefix = join(absRoot, "sub", ".grove", repoName);
    expect(poolDir.startsWith(expectedPrefix)).toBe(true);

    delete process.env["TEST_GROVE_ROOT"];
    delete process.env["var2"];
  });
});
