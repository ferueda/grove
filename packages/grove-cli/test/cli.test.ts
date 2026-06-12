import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execa } from "execa";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { setupRepo } from "../../grove/test/helpers/git-repo.js";

const CLI_PATH = join(import.meta.dirname, "..", "dist", "cli.js");

describe("grove CLI lease-first JSON", () => {
  let tmpDirs: string[] = [];

  beforeEach(() => {
    tmpDirs = [];
  });

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function runCli(args: string[], env: Record<string, string>) {
    return execa("node", [CLI_PATH, ...args], {
      env: { ...process.env, ...env },
      reject: false,
    });
  }

  it("acquire --json writes lease envelope to stdout only", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const result = await runCli(
      [
        "acquire",
        "--json",
        "--lease-id",
        "cli-lease",
        "--branch",
        "cli-branch",
        "--create-from",
        "main",
        "-r",
        repoDir,
      ],
      { GROVE_DIR: groveDir },
    );

    expect(result.exitCode).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body).toMatchObject({
      ok: true,
      lease: { leaseId: "cli-lease", state: "leased" },
    });
    expect(result.stderr).toBe("");
  });

  it("acquire requires explicit branch reuse for existing branches", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);
    await execa("git", ["branch", "existing-cli-branch", "main"], { cwd: repoDir });

    const failed = await runCli(
      [
        "acquire",
        "--json",
        "--lease-id",
        "existing-cli-fail",
        "--branch",
        "existing-cli-branch",
        "--create-from",
        "main",
        "-r",
        repoDir,
      ],
      { GROVE_DIR: groveDir },
    );

    expect(failed.exitCode).toBe(13);
    expect(JSON.parse(failed.stdout)).toMatchObject({
      ok: false,
      error: { code: "BRANCH_EXISTS" },
    });

    const reused = await runCli(
      [
        "acquire",
        "--json",
        "--lease-id",
        "existing-cli-reuse",
        "--branch",
        "existing-cli-branch",
        "--create-from",
        "main",
        "--reuse-existing-branch",
        "-r",
        repoDir,
      ],
      { GROVE_DIR: groveDir },
    );

    expect(reused.exitCode).toBe(0);
    expect(JSON.parse(reused.stdout)).toMatchObject({
      ok: true,
      lease: { leaseId: "existing-cli-reuse", state: "leased" },
    });
    expect(reused.stderr).toBe("");
  });

  it("list --json writes leases envelope to stdout only", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    await runCli(
      ["acquire", "--json", "--lease-id", "list-lease", "--ref", "main", "-r", repoDir],
      { GROVE_DIR: groveDir },
    );

    const result = await runCli(["list", "--json", "-r", repoDir], { GROVE_DIR: groveDir });
    expect(result.exitCode).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body.ok).toBe(true);
    expect(body.leases).toHaveLength(1);
    expect(body.leases[0]).toMatchObject({ leaseId: "list-lease" });
    expect(result.stderr).toBe("");
  });

  it("release --json writes result envelope to stdout", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    await runCli(
      ["acquire", "--json", "--lease-id", "release-lease", "--ref", "main", "-r", repoDir],
      { GROVE_DIR: groveDir },
    );

    const result = await runCli(
      ["release", "--json", "--lease-id", "release-lease", "--cleanup", "preserve", "-r", repoDir],
      { GROVE_DIR: groveDir },
    );

    expect(result.exitCode).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body).toMatchObject({
      ok: true,
      result: { status: "preserved", leaseId: "release-lease" },
    });
    expect(result.stderr).toBe("");
  });

  it("errors use stable JSON envelope on stdout with mapped exit code", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    await runCli(
      [
        "acquire",
        "--json",
        "--lease-id",
        "conflict-lease",
        "--branch",
        "branch-a",
        "--create-from",
        "main",
        "-r",
        repoDir,
      ],
      { GROVE_DIR: groveDir },
    );

    const result = await runCli(
      ["acquire", "--json", "--lease-id", "conflict-lease", "--branch", "branch-b", "-r", repoDir],
      { GROVE_DIR: groveDir },
    );

    expect(result.exitCode).toBe(3);
    const body = JSON.parse(result.stdout);
    expect(body).toEqual({
      ok: false,
      error: {
        code: "LEASE_CONFLICT",
        message: expect.stringContaining("branch"),
        details: {},
      },
    });
    expect(result.stderr).toBe("");
  });

  it("human mode writes prose to stderr, not stdout", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const result = await runCli(
      ["acquire", "--lease-id", "human-lease", "--ref", "main", "-r", repoDir],
      { GROVE_DIR: groveDir },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("human-lease");
  });
});
