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

  function parseJson(result: { stdout: string }) {
    return JSON.parse(result.stdout);
  }

  function expectStdoutOnly(result: { stdout: string; stderr: string }) {
    expect(result.stderr).toBe("");
    return parseJson(result);
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

  it("inspect --json writes lease envelope to stdout only", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    await seedLease(repoDir, groveDir, {
      leaseId: "inspect-lease",
      mode: "detached",
      ref: "main",
    });

    const result = await runCli(
      ["inspect", "--json", "--lease-id", "inspect-lease", "-r", repoDir],
      { GROVE_DIR: groveDir },
    );

    expect(result.exitCode).toBe(0);
    const body = expectStdoutOnly(result);
    expect(body).toMatchObject({
      ok: true,
      lease: { leaseId: "inspect-lease", state: "leased" },
    });
    expect(body.suggestions).toEqual(expect.any(Array));
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

  it("destroy --json writes result envelope to stdout only", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    await seedLease(repoDir, groveDir, {
      leaseId: "destroy-lease",
      mode: "detached",
      ref: "main",
    });

    const result = await runCli(
      ["destroy", "--json", "--lease-id", "destroy-lease", "--force", "-r", repoDir],
      { GROVE_DIR: groveDir },
    );

    expect(result.exitCode).toBe(0);
    const body = expectStdoutOnly(result);
    expect(body).toMatchObject({
      ok: true,
      result: { status: "destroyed", leaseId: "destroy-lease" },
    });
    expect(body.suggestions).toEqual(expect.any(Array));

    const missing = await runCli(
      ["inspect", "--json", "--lease-id", "destroy-lease", "-r", repoDir],
      { GROVE_DIR: groveDir },
    );

    expect(missing.exitCode).toBe(8);
    expect(parseJson(missing)).toMatchObject({
      ok: false,
      error: { code: "LEASE_NOT_FOUND" },
    });
    expect(missing.stderr).toBe("");
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
      error: {
        code: "INVALID_INPUT",
        message: "Invalid lease ID format",
        details: { leaseId: "bad id!" },
      },
    });
    expect(result.stderr).toBe("");
  });

  it("acquire --json without branch or ref reports structured INVALID_INPUT", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const result = await runCli(
      ["acquire", "--json", "--lease-id", "needs-target", "-r", repoDir],
      { GROVE_DIR: groveDir },
    );

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Acquire requires either --branch or --ref",
        details: { missing: ["branch", "ref"], requireOneOf: ["branch", "ref"] },
      },
    });
    expect(result.stderr).toBe("");
  });

  it("acquire --json without lease-id routes commander error through JSON envelope", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const result = await runCli(
      ["acquire", "--json", "--branch", "cli-branch", "--create-from", "main", "-r", repoDir],
      { GROVE_DIR: groveDir },
    );

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        details: {
          missing: ["leaseId"],
          source: "commander",
          commanderCode: "commander.missingMandatoryOptionValue",
        },
      },
    });
    expect(result.stderr).toBe("");
  });

  it("acquire --json on occupied branch reports WORKTREE_IN_USE with structured details", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const result = await runCli(
      ["acquire", "--json", "--lease-id", "main-lease", "--branch", "main", "-r", repoDir],
      { GROVE_DIR: groveDir },
    );

    expect(result.exitCode).toBe(7);
    const body = JSON.parse(result.stdout);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("WORKTREE_IN_USE");
    expect(body.error.message).toContain("already checked out");
    expect(body.error.details).toMatchObject({
      branch: "main",
      reason: "branch_already_checked_out",
    });
    expect(result.stderr).toBe("");
  });

  it("acquire --json on missing ref reports REF_NOT_FOUND", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const result = await runCli(
      [
        "acquire",
        "--json",
        "--lease-id",
        "missing-ref-lease",
        "--ref",
        "no-such-ref",
        "-r",
        repoDir,
      ],
      { GROVE_DIR: groveDir },
    );

    expect(result.exitCode).toBe(13);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "REF_NOT_FOUND" },
    });
    expect(result.stderr).toBe("");
  });

  it("acquire --json on missing branch reports BRANCH_NOT_FOUND with structured details", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const result = await runCli(
      [
        "acquire",
        "--json",
        "--lease-id",
        "missing-branch-lease",
        "--branch",
        "no-such-branch-xyz",
        "-r",
        repoDir,
      ],
      { GROVE_DIR: groveDir },
    );

    expect(result.exitCode).toBe(13);
    const body = JSON.parse(result.stdout);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("BRANCH_NOT_FOUND");
    expect(body.error.details).toMatchObject({
      branch: "no-such-branch-xyz",
      reason: "not_found",
    });
    expect(result.stderr).toBe("");
  });

  it("release --json without cleanup routes commander error through JSON envelope", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const result = await runCli(
      ["release", "--json", "--lease-id", "release-missing-cleanup", "-r", repoDir],
      { GROVE_DIR: groveDir },
    );

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: expect.stringContaining("--cleanup"),
        details: {
          missing: ["cleanup"],
          source: "commander",
          commanderCode: "commander.missingMandatoryOptionValue",
        },
      },
    });
    expect(result.stderr).toBe("");
  });

  it("release with typo lease-id flag routes commander error through JSON envelope", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const result = await runCli(
      ["release", "--json", "--leasw-id", "typo-lease", "--cleanup", "preserve", "-r", repoDir],
      { GROVE_DIR: groveDir },
    );

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        details: {
          missing: ["leaseId"],
          source: "commander",
          commanderCode: "commander.missingMandatoryOptionValue",
        },
      },
    });
    expect(result.stderr).toBe("");
  });

  it("release without cleanup writes INVALID_INPUT to stderr in human mode", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const result = await runCli(
      ["release", "--lease-id", "human-release", "-r", repoDir],
      { GROVE_DIR: groveDir },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("[INVALID_INPUT]");
    expect(result.stderr).toContain("--cleanup");
  });

  it("release --json rejects invalid cleanup with structured INVALID_INPUT", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    await seedLease(repoDir, groveDir, {
      leaseId: "release-invalid-cleanup",
      mode: "detached",
      ref: "main",
    });

    const result = await runCli(
      [
        "release",
        "--json",
        "--lease-id",
        "release-invalid-cleanup",
        "--cleanup",
        "not-a-cleanup",
        "-r",
        repoDir,
      ],
      { GROVE_DIR: groveDir },
    );

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Invalid cleanup action",
        details: {
          cleanup: "not-a-cleanup",
          allowed: ["preserve", "reset", "quarantine"],
        },
      },
    });
    expect(result.stderr).toBe("");
  });

  it("repair --json quarantine writes result envelope to stdout only", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    await seedLease(repoDir, groveDir, {
      leaseId: "repair-quarantine-lease",
      mode: "detached",
      ref: "main",
    });

    const result = await runCli(
      [
        "repair",
        "--json",
        "--lease-id",
        "repair-quarantine-lease",
        "--action",
        "quarantine",
        "-r",
        repoDir,
      ],
      { GROVE_DIR: groveDir },
    );

    expect(result.exitCode).toBe(0);
    const body = expectStdoutOnly(result);
    expect(body.ok).toBe(true);
    expect(body.result).toMatchObject({
      status: "quarantined",
      leaseId: "repair-quarantine-lease",
      lease: { leaseId: "repair-quarantine-lease", state: "quarantined" },
    });
    expect(body.suggestions).toEqual(expect.any(Array));
  });

  it("repair --json rejects invalid action with structured INVALID_INPUT", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const result = await runCli(
      [
        "repair",
        "--json",
        "--lease-id",
        "repair-invalid-action",
        "--action",
        "not-an-action",
        "-r",
        repoDir,
      ],
      { GROVE_DIR: groveDir },
    );

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        details: {
          action: "not-an-action",
          allowed: ["quarantine", "resume-acquire", "resume-cleanup", "force-destroy"],
        },
      },
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

describe("grove CLI informational exits", () => {
  async function runCli(args: string[]) {
    return execa("node", [CLI_PATH, ...args], { reject: false });
  }

  it("bare invocation shows help without INVALID_INPUT on stderr", async () => {
    const result = await runCli([]);
    expect(result.stdout).toContain("Usage: grove");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(1);
  });

  it("version flags print version without INVALID_INPUT on stderr", async () => {
    for (const flag of ["-V", "--version"]) {
      const result = await runCli([flag]);
      expect(result.stdout.trim()).toBe("0.1.0");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    }
  });

  it("help flags show help without INVALID_INPUT on stderr", async () => {
    for (const flag of ["-h", "--help"]) {
      const result = await runCli([flag]);
      expect(result.stdout).toContain("Usage: grove");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    }
  });
});
