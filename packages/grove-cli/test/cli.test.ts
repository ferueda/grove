import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execa } from "execa";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { setupRepo } from "../../grove/test/helpers/git-repo.js";
import { seedLease } from "./helpers/seed-lease.js";

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
    expect(body.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: expect.stringContaining("grove release --json --lease-id cli-lease"),
        }),
      ]),
    );
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

    await seedLease(repoDir, groveDir, {
      leaseId: "list-lease",
      mode: "detached",
      ref: "main",
    });

    const result = await runCli(["list", "--json", "-r", repoDir], { GROVE_DIR: groveDir });
    expect(result.exitCode).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body.ok).toBe(true);
    expect(body.leases).toHaveLength(1);
    expect(body.leases[0]).toMatchObject({ leaseId: "list-lease" });
    expect(body.count).toBe(1);
    expect(body.byState.leased).toBe(1);
    expect(body.pool.max).toBe(16);
    expect(body.pool.used).toBeGreaterThanOrEqual(1);
    expect(body.pool.available).toBe(body.pool.max - body.pool.used);
    expect(body.suggestions).toEqual(expect.any(Array));
    expect(result.stderr).toBe("");
  });

  it("release --json writes result envelope to stdout", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    await seedLease(repoDir, groveDir, {
      leaseId: "release-lease",
      mode: "detached",
      ref: "main",
    });

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
    expect(body.suggestions).toEqual(expect.any(Array));
    expect(result.stderr).toBe("");
  });

  it("errors use stable JSON envelope on stdout with mapped exit code", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    await seedLease(repoDir, groveDir, {
      leaseId: "conflict-lease",
      mode: "branch",
      branch: "branch-a",
      createBranch: { from: "main", ifExists: "fail" },
    });

    const result = await runCli(
      ["acquire", "--json", "--lease-id", "conflict-lease", "--branch", "branch-b", "-r", repoDir],
      { GROVE_DIR: groveDir },
    );

    expect(result.exitCode).toBe(3);
    const body = JSON.parse(result.stdout);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("LEASE_CONFLICT");
    expect(body.error.message).toEqual(expect.stringContaining("branch"));
    expect(body.error.details).toMatchObject({
      leaseId: "conflict-lease",
      existingState: "leased",
      existingBranch: "branch-a",
      requestedBranch: "branch-b",
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

  it("acquire rejects invalid lease id with INVALID_INPUT", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const result = await runCli(
      [
        "acquire",
        "--json",
        "--lease-id",
        "bad id!",
        "--branch",
        "cli-invalid-id-branch",
        "--create-from",
        "main",
        "-r",
        repoDir,
      ],
      { GROVE_DIR: groveDir },
    );

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT", message: "Invalid lease ID format" },
    });
    expect(result.stderr).toBe("");
  });

  it("commands --json writes machine-readable command catalog", async () => {
    const result = await runCli(["commands", "--json"], {});

    expect(result.exitCode).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body.ok).toBe(true);
    const names = body.commands.map((cmd: { name: string }) => cmd.name);
    expect(names).toEqual(expect.arrayContaining(["acquire", "list", "repair"]));
    expect(result.stderr).toBe("");
  });

  it("status --json writes pool dashboard", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    await seedLease(repoDir, groveDir, {
      leaseId: "status-lease",
      mode: "detached",
      ref: "main",
    });

    const result = await runCli(["status", "--json", "-r", repoDir], { GROVE_DIR: groveDir });
    expect(result.exitCode).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body.ok).toBe(true);
    expect(body.repoRoot).toBe(repoDir);
    expect(body.poolDir).toBe(groveDir);
    expect(body.count).toBe(1);
    expect(body.byState.leased).toBe(1);
    expect(body.pool.max).toBe(16);
    expect(body.leases).toHaveLength(1);
    expect(body.suggestions).toEqual(expect.any(Array));
    expect(result.stderr).toBe("");
  });
});
