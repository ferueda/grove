import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createGrove } from "../src/index.js";
import { setupRepo } from "./helpers/git-repo.js";
import { rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { execa } from "execa";

describe("Grove Lease Mode Integration", () => {
  let tmpDirs: string[] = [];

  beforeEach(() => {
    tmpDirs = [];
  });

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  function failOnceHook(counterPath: string): string {
    const script =
      "const fs = require('node:fs'); const p = process.argv[1]; const n = fs.existsSync(p) ? Number(fs.readFileSync(p, 'utf8')) : 0; fs.writeFileSync(p, String(n + 1)); if (n === 0) process.exit(1);";
    return ["node", "-e", JSON.stringify(script), JSON.stringify(counterPath)].join(" ");
  }

  it("reacquire allows commits made inside the leased branch worktree", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });

    const lease1 = await grove.acquire({
      leaseId: "commit-lease",
      mode: "branch",
      branch: "work-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    await execa("git", ["commit", "--allow-empty", "-m", "work"], { cwd: lease1.path });

    const lease2 = await grove.acquire({
      leaseId: "commit-lease",
      mode: "branch",
      branch: "work-branch",
      ifLeased: "return-existing",
    });

    expect(lease2.leaseId).toBe("commit-lease");
    expect(lease2.path).toBe(lease1.path);
    expect(lease2.state).toBe("leased");
  });

  it("postAcquire hook failure does not quarantine a leased acquire", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({
      repoRoot: repoDir,
      groveRoot: groveDir,
      onHookFailure: "fail",
      hooks: {
        postAcquire: ["exit 1"],
      },
    });

    await expect(
      grove.acquire({
        leaseId: "hook-fail-lease",
        mode: "branch",
        branch: "hook-branch",
        createBranch: { from: "main", ifExists: "fail" },
      }),
    ).rejects.toThrow(/Hook failed/);

    const leases = await grove.list();
    expect(leases).toHaveLength(1);
    expect(leases[0]?.leaseId).toBe("hook-fail-lease");
    expect(leases[0]?.state).toBe("leased");
  });

  it("postCreate hook failure quarantines a pending acquire", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({
      repoRoot: repoDir,
      groveRoot: groveDir,
      onHookFailure: "fail",
      hooks: {
        postCreate: ["exit 1"],
      },
    });

    await expect(
      grove.acquire({
        leaseId: "post-create-fail",
        mode: "branch",
        branch: "post-create-fail-branch",
        createBranch: { from: "main", ifExists: "fail" },
      }),
    ).rejects.toThrow(/Hook failed/);

    const lease = await grove.inspect("post-create-fail");
    expect(lease).toMatchObject({
      leaseId: "post-create-fail",
      state: "quarantined",
      pendingAcquire: expect.anything(),
      diagnostics: { failedPhase: "postCreate" },
    });
  });

  it("repair resume-acquire reruns a failed postCreate hook", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const attemptsPath = join(tmpDir, "post-create-attempts.txt");
    const hook = failOnceHook(attemptsPath);

    const grove = await createGrove({
      repoRoot: repoDir,
      groveRoot: groveDir,
      onHookFailure: "fail",
      hooks: {
        postCreate: [hook],
      },
    });

    await expect(
      grove.acquire({
        leaseId: "repair-post-create",
        mode: "branch",
        branch: "repair-post-create-branch",
        createBranch: { from: "main", ifExists: "fail" },
      }),
    ).rejects.toThrow(/Hook failed/);
    expect(await readFile(attemptsPath, "utf8")).toBe("1");

    const repaired = await grove.repair({
      leaseId: "repair-post-create",
      action: "resume-acquire",
    });

    expect(repaired).toMatchObject({
      leaseId: "repair-post-create",
      state: "leased",
      branch: "repair-post-create-branch",
    });
    expect(await readFile(attemptsPath, "utf8")).toBe("2");
  });

  it("preRelease hook failure quarantines the pending cleanup", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({
      repoRoot: repoDir,
      groveRoot: groveDir,
      onHookFailure: "fail",
      hooks: {
        preRelease: ["exit 1"],
      },
    });

    const lease = await grove.acquire({
      leaseId: "pre-release-fail",
      mode: "branch",
      branch: "pre-release-fail-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    await expect(grove.release(lease.leaseId, { cleanup: "preserve" })).rejects.toThrow(
      /Hook failed/,
    );

    const inspected = await grove.inspect("pre-release-fail");
    expect(inspected).toMatchObject({
      leaseId: "pre-release-fail",
      state: "quarantined",
      pendingCleanup: { cleanup: "preserve" },
      diagnostics: { failedPhase: "preRelease" },
    });
  });

  it("repair resume-cleanup reruns a failed preRelease hook", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const attemptsPath = join(tmpDir, "pre-release-attempts.txt");
    const grove = await createGrove({
      repoRoot: repoDir,
      groveRoot: groveDir,
      onHookFailure: "fail",
      hooks: {
        preRelease: [failOnceHook(attemptsPath)],
      },
    });

    const lease = await grove.acquire({
      leaseId: "repair-pre-release",
      mode: "branch",
      branch: "repair-pre-release-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    await expect(grove.release(lease.leaseId, { cleanup: "preserve" })).rejects.toThrow(
      /Hook failed/,
    );
    expect(await readFile(attemptsPath, "utf8")).toBe("1");

    const result = await grove.repair({
      leaseId: "repair-pre-release",
      action: "resume-cleanup",
    });

    expect(result).toMatchObject({ status: "preserved", leaseId: "repair-pre-release" });
    expect(await readFile(attemptsPath, "utf8")).toBe("2");
    expect(await grove.inspect("repair-pre-release")).toMatchObject({
      state: "leased",
      pendingCleanup: undefined,
    });
  });

  it("acquire idempotency for leases", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });

    const lease1 = await grove.acquire({
      leaseId: "test-lease",
      mode: "branch",
      branch: "test-branch-1",
      createBranch: { from: "main", ifExists: "fail" },
    });

    expect(lease1.leaseId).toBe("test-lease");
    expect(lease1.state).toBe("leased");
    expect(lease1.branch).toBe("test-branch-1");

    const lease2 = await grove.acquire({
      leaseId: "test-lease",
      mode: "branch",
      branch: "test-branch-1",
      ifLeased: "return-existing",
    });

    expect(lease2.path).toBe(lease1.path);
    expect(lease2.leaseId).toBe("test-lease");

    await expect(
      grove.acquire({
        leaseId: "test-lease",
        mode: "branch",
        branch: "other",
        ifLeased: "return-existing",
      }),
    ).rejects.toThrow("Lease conflict");

    await expect(
      grove.acquire({
        leaseId: "test-lease",
        mode: "branch",
        branch: "test-branch-1",
        ifLeased: "fail",
      }),
    ).rejects.toThrow("already exists");
  });

  it("process safety enforcement during destructive operations", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });

    const lease = await grove.acquire({
      leaseId: "safety-lease",
      mode: "branch",
      branch: "safety-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    const scriptPath = join(tmpDir, "sleep.mjs");
    await writeFile(scriptPath, "setInterval(() => {}, 1000);");

    const child = execa("node", [scriptPath], { cwd: lease.path });
    await new Promise((r) => setTimeout(r, 500)); // wait for start

    try {
      await expect(
        grove.release(lease.leaseId, { cleanup: "reset", resetTo: "main" }),
      ).rejects.toThrow(/Unsafe cleanup: active processes/);

      await expect(grove.destroy(lease.leaseId)).rejects.toThrow(/is in use/);

      // forceful bypass
      await grove.destroy(lease.leaseId, { force: true });
    } finally {
      child.kill();
      await child.catch(() => {});
    }
  });

  it("preserve release keeps dirty files and returns preserved lease", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "preserve-lease",
      mode: "branch",
      branch: "preserve-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    const dirtyPath = join(lease.path, "dirty.txt");
    await writeFile(dirtyPath, "dirty");

    const result = await grove.release(lease.leaseId, { cleanup: "preserve" });
    expect(result).toEqual({
      status: "preserved",
      leaseId: "preserve-lease",
      lease: expect.objectContaining({ state: "leased", leaseId: "preserve-lease" }),
    });
    expect(existsSync(dirtyPath)).toBe(true);

    const reacquired = await grove.acquire({
      leaseId: "preserve-lease",
      mode: "branch",
      branch: "preserve-branch",
      ifLeased: "return-existing",
    });
    expect(reacquired.path).toBe(lease.path);
  });

  it("reset release clears lease and returns slot to available pool", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "reset-lease",
      mode: "branch",
      branch: "reset-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    await writeFile(join(lease.path, "untracked.txt"), "remove-me");

    const result = await grove.release(lease.leaseId, {
      cleanup: "reset",
      resetTo: "main",
      force: true,
    });
    expect(result).toMatchObject({
      status: "released",
      leaseId: "reset-lease",
      path: lease.path,
    });
    expect(await grove.list()).toHaveLength(0);
    expect(existsSync(join(lease.path, "untracked.txt"))).toBe(false);

    const statePath = join(grove.poolDir, "grove-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    expect(state.slots.find((slot: { path: string }) => slot.path === lease.path)?.state).toBe(
      "available",
    );
  });

  it("reset release returns a clean slot for the next acquire", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "reset-reuse-lease",
      mode: "branch",
      branch: "reset-reuse-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    await writeFile(join(lease.path, "dirty.txt"), "remove-me");
    await grove.release(lease.leaseId, { cleanup: "reset", resetTo: "main", force: true });

    const reused = await grove.acquire({
      leaseId: "reset-reuse-next",
      mode: "detached",
      ref: "main",
    });

    expect(reused.slotName).toBe(lease.slotName);
    expect(existsSync(join(reused.path, "dirty.txt"))).toBe(false);
  });

  it("reset preserves ignored files by default and removes them with cleanIgnored", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "clean-lease",
      mode: "branch",
      branch: "clean-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    await writeFile(join(lease.path, ".gitignore"), "cache/\n");
    await mkdir(join(lease.path, "cache"), { recursive: true });
    await writeFile(join(lease.path, "cache/ignored.txt"), "cached");

    await grove.release(lease.leaseId, {
      cleanup: "reset",
      resetTo: "main",
      force: true,
    });
    expect(existsSync(join(lease.path, "cache/ignored.txt"))).toBe(true);

    const lease2 = await grove.acquire({
      leaseId: "clean-lease-2",
      mode: "branch",
      branch: "clean-branch-2",
      createBranch: { from: "main", ifExists: "fail" },
    });
    await writeFile(join(lease2.path, ".gitignore"), "cache/\n");
    await mkdir(join(lease2.path, "cache"), { recursive: true });
    await writeFile(join(lease2.path, "cache/ignored.txt"), "cached");

    await grove.release(lease2.leaseId, {
      cleanup: "reset",
      resetTo: "main",
      force: true,
      cleanIgnored: true,
    });
    expect(existsSync(join(lease2.path, "cache/ignored.txt"))).toBe(false);
  });

  it("quarantine release returns quarantined lease", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "quarantine-lease",
      mode: "branch",
      branch: "quarantine-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    const result = await grove.release(lease.leaseId, { cleanup: "quarantine" });
    expect(result).toEqual({
      status: "quarantined",
      leaseId: "quarantine-lease",
      lease: expect.objectContaining({ state: "quarantined", leaseId: "quarantine-lease" }),
    });
  });

  it("reset performs fresh process safety scan immediately before destructive cleanup", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "fresh-safety",
      mode: "branch",
      branch: "fresh-safety-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    await grove.release(lease.leaseId, { cleanup: "preserve" });

    const statePath = join(grove.poolDir, "grove-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.leases[0].state = "releasing";
    state.leases[0].pendingCleanup = { cleanup: "reset", resetTo: "main" };
    await writeFile(statePath, JSON.stringify(state));

    const scriptPath = join(tmpDir, "sleep.mjs");
    await writeFile(scriptPath, "setInterval(() => {}, 1000);");
    const child = execa("node", [scriptPath], { cwd: lease.path });
    await new Promise((r) => setTimeout(r, 500));

    try {
      await expect(
        grove.repair({ leaseId: "fresh-safety", action: "resume-cleanup" }),
      ).rejects.toThrow(/Unsafe cleanup: active processes/);
    } finally {
      child.kill();
      await child.catch(() => {});
    }

    const stuck = await grove.inspect("fresh-safety");
    expect(stuck?.state).toBe("releasing");
    expect(stuck?.pendingCleanup).toMatchObject({ cleanup: "reset", resetTo: "main" });
  });

  it("release on quarantined lease throws LEASE_QUARANTINED", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "quarantined-release",
      mode: "branch",
      branch: "quarantined-release-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    await grove.release(lease.leaseId, { cleanup: "quarantine" });

    await expect(grove.release(lease.leaseId, { cleanup: "preserve" })).rejects.toMatchObject({
      code: "LEASE_QUARANTINED",
    });
  });

  it("release on busy releasing lease throws LEASE_BUSY", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "busy-release",
      mode: "branch",
      branch: "busy-release-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    const statePath = join(grove.poolDir, "grove-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.leases[0].state = "releasing";
    state.leases[0].pendingCleanup = { cleanup: "preserve" };
    await writeFile(statePath, JSON.stringify(state));

    await expect(grove.release(lease.leaseId, { cleanup: "preserve" })).rejects.toMatchObject({
      code: "LEASE_BUSY",
    });
  });

  it("resume-cleanup completes interrupted preserve release", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "resume-cleanup-lease",
      mode: "branch",
      branch: "resume-cleanup-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    const statePath = join(grove.poolDir, "grove-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.leases[0].state = "releasing";
    state.leases[0].pendingCleanup = { cleanup: "preserve" };
    await writeFile(statePath, JSON.stringify(state));

    const result = await grove.repair({
      leaseId: "resume-cleanup-lease",
      action: "resume-cleanup",
    });
    expect(result).toMatchObject({
      status: "preserved",
      leaseId: "resume-cleanup-lease",
    });
    expect((await grove.inspect("resume-cleanup-lease"))?.state).toBe("leased");
    expect(existsSync(lease.path)).toBe(true);
  });

  it("repair intent test", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });

    const lease = await grove.acquire({
      leaseId: "repair-lease",
      mode: "branch",
      branch: "repair-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    // Simulate failure during release (state marked releasing)
    await expect(
      grove.release(lease.leaseId, { cleanup: "reset", resetTo: "invalid-branch", force: true }),
    ).rejects.toThrow(/Cleanup failed/);

    const list = await grove.list();
    const l = list.find((x) => x.leaseId === "repair-lease");
    expect(l?.state).toBe("quarantined");
    expect(l?.pendingCleanup).toMatchObject({ cleanup: "reset", resetTo: "invalid-branch" });

    const result = await grove.repair({
      leaseId: "repair-lease",
      action: "quarantine",
    });
    expect(result).toMatchObject({
      status: "quarantined",
      leaseId: "repair-lease",
      lease: expect.objectContaining({ state: "quarantined" }),
    });
  });

  it("repair quarantine clears active slot owner fields", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    await grove.acquire({
      leaseId: "owner-lease",
      mode: "branch",
      branch: "owner-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    const statePath = join(grove.poolDir, "grove-state.json");
    let state = JSON.parse(await readFile(statePath, "utf8"));
    expect(state.slots[0].ownerPid).toBeDefined();
    expect(state.slots[0].ownerStartedAt).toBeDefined();

    await grove.repair({ leaseId: "owner-lease", action: "quarantine" });

    state = JSON.parse(await readFile(statePath, "utf8"));
    expect(state.slots[0].state).toBe("quarantined");
    expect(state.slots[0].ownerPid).toBeUndefined();
    expect(state.slots[0].ownerStartedAt).toBeUndefined();
    expect(state.leases[0].ownerId).toBeUndefined();
  });

  it("repair quarantine on already-quarantined lease clears stale slot owner fields", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    await grove.acquire({
      leaseId: "stale-owner-lease",
      mode: "branch",
      branch: "stale-owner-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });
    await grove.release("stale-owner-lease", { cleanup: "quarantine" });

    const statePath = join(grove.poolDir, "grove-state.json");
    let state = JSON.parse(await readFile(statePath, "utf8"));
    state.slots[0].ownerPid = process.pid;
    state.slots[0].ownerStartedAt = Date.now();
    await writeFile(statePath, JSON.stringify(state));

    await grove.repair({ leaseId: "stale-owner-lease", action: "quarantine" });

    state = JSON.parse(await readFile(statePath, "utf8"));
    expect(state.slots[0].ownerPid).toBeUndefined();
    expect(state.slots[0].ownerStartedAt).toBeUndefined();
  });

  it("repair resume-acquire without pendingAcquire throws REPAIR_NOT_AVAILABLE", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    await grove.acquire({
      leaseId: "no-pending",
      mode: "branch",
      branch: "no-pending-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    await expect(
      grove.repair({ leaseId: "no-pending", action: "resume-acquire" }),
    ).rejects.toMatchObject({ code: "REPAIR_NOT_AVAILABLE" });
  });

  it("repair resume-cleanup without pendingCleanup throws REPAIR_NOT_AVAILABLE", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    await grove.acquire({
      leaseId: "no-cleanup",
      mode: "branch",
      branch: "no-cleanup-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    await expect(
      grove.repair({ leaseId: "no-cleanup", action: "resume-cleanup" }),
    ).rejects.toMatchObject({ code: "REPAIR_NOT_AVAILABLE" });
  });

  it("repair quarantine from preparing moves lease and slot to quarantined", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    await grove.acquire({
      leaseId: "preparing-lease",
      mode: "branch",
      branch: "preparing-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    const statePath = join(grove.poolDir, "grove-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.leases[0].pendingAcquire = {
      target: state.leases[0].target,
      startedAt: state.leases[0].updatedAt,
    };
    state.leases[0].state = "preparing";
    state.leases[0].target = undefined;
    state.leases[0].acquiredHeadSha = undefined;
    state.leases[0].currentHeadSha = undefined;
    await writeFile(statePath, JSON.stringify(state));

    const result = await grove.repair({
      leaseId: "preparing-lease",
      action: "quarantine",
    });
    expect(result).toMatchObject({
      status: "quarantined",
      lease: expect.objectContaining({
        state: "quarantined",
        pendingAcquire: expect.objectContaining({ target: expect.anything() }),
      }),
    });

    const raw = JSON.parse(await readFile(statePath, "utf8"));
    expect(raw.leases[0].state).toBe("quarantined");
    expect(raw.slots[0].state).toBe("quarantined");
  });

  it("repair quarantine from releasing moves lease and slot to quarantined", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    await grove.acquire({
      leaseId: "releasing-lease",
      mode: "branch",
      branch: "releasing-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    const statePath = join(grove.poolDir, "grove-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.leases[0].state = "releasing";
    state.leases[0].pendingCleanup = { cleanup: "preserve" };
    await writeFile(statePath, JSON.stringify(state));

    const result = await grove.repair({
      leaseId: "releasing-lease",
      action: "quarantine",
    });
    expect(result).toMatchObject({
      status: "quarantined",
      lease: expect.objectContaining({ state: "quarantined" }),
    });

    const raw = JSON.parse(await readFile(statePath, "utf8"));
    expect(raw.leases[0].state).toBe("quarantined");
    expect(raw.slots[0].state).toBe("quarantined");
    expect(raw.leases[0].pendingCleanup).toBeUndefined();
  });

  it("repair quarantine from destroying moves lease and slot to quarantined", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "destroying-lease",
      mode: "branch",
      branch: "destroying-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    const statePath = join(grove.poolDir, "grove-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.leases[0].state = "destroying";
    state.slots[0].state = "destroying";
    await writeFile(statePath, JSON.stringify(state));

    const result = await grove.repair({
      leaseId: "destroying-lease",
      action: "quarantine",
    });
    expect(result).toMatchObject({
      status: "quarantined",
      lease: expect.objectContaining({ state: "quarantined" }),
    });
    expect(existsSync(lease.path)).toBe(true);

    const raw = JSON.parse(await readFile(statePath, "utf8"));
    expect(raw.leases[0].state).toBe("quarantined");
    expect(raw.slots[0].state).toBe("quarantined");
  });

  it("repair force-destroy removes lease and worktree", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "force-destroy-lease",
      mode: "branch",
      branch: "force-destroy-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    const result = await grove.repair({
      leaseId: "force-destroy-lease",
      action: "force-destroy",
      force: true,
    });
    expect(result).toEqual({ status: "destroyed", leaseId: "force-destroy-lease" });
    expect(await grove.inspect("force-destroy-lease")).toBeNull();
    expect(existsSync(lease.path)).toBe(false);
  });

  it("release rejects physical worktree paths and only accepts leaseId", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "path-release-lease",
      mode: "branch",
      branch: "path-release-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    await expect(grove.release(lease.path, { cleanup: "preserve" })).rejects.toMatchObject({
      code: "LEASE_NOT_FOUND",
    });
    expect(await grove.inspect("path-release-lease")).toMatchObject({ state: "leased" });
  });

  it("destroy rejects physical worktree paths and only accepts leaseId", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "path-destroy-lease",
      mode: "branch",
      branch: "path-destroy-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    await expect(grove.destroy(lease.path, { force: true })).rejects.toMatchObject({
      code: "LEASE_NOT_FOUND",
    });
    expect(await grove.inspect("path-destroy-lease")).toMatchObject({ state: "leased" });
    expect(existsSync(lease.path)).toBe(true);
  });

  it("destroy rejects paths outside the pool boundary and quarantines the lease", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "boundary-lease",
      mode: "branch",
      branch: "boundary-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    const outsidePath = join(tmpDir, "outside-pool", "repo");
    await mkdir(outsidePath, { recursive: true });
    const statePath = join(grove.poolDir, "grove-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.slots[0].path = outsidePath;
    state.leases[0].path = outsidePath;
    await writeFile(statePath, JSON.stringify(state));

    await expect(grove.destroy(lease.leaseId, { force: true })).rejects.toThrow(
      /outside the pool boundary/,
    );

    const quarantined = await grove.inspect("boundary-lease");
    expect(quarantined?.state).toBe("quarantined");
  });

  it("idempotent destroy resumes an in-progress destroying lease", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "resume-destroy",
      mode: "branch",
      branch: "resume-destroy-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    const statePath = join(grove.poolDir, "grove-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.leases[0].state = "destroying";
    state.slots[0].state = "destroying";
    state.slots[0].ownerPid = process.pid;
    await writeFile(statePath, JSON.stringify(state));

    await grove.destroy(lease.leaseId, { force: true });
    expect(await grove.inspect("resume-destroy")).toBeNull();
    expect(existsSync(lease.path)).toBe(false);
  });

  it("rejects deleteBranch in lease-first destroy MVP", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({
      repoRoot: repoDir,
      groveRoot: groveDir,
      safeDeleteBranchPrefixes: ["pr/"],
    });

    const lease = await grove.acquire({
      leaseId: "pr-123",
      mode: "branch",
      branch: "pr/123",
      createBranch: { from: "main", ifExists: "fail" },
    });

    await expect(
      grove.destroy(lease.leaseId, { force: true, deleteBranch: true }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await execa("git", ["rev-parse", "--verify", "pr/123"], { cwd: repoDir });
  });

  it("failed checkout quarantines lease and preserves pendingAcquire for repair", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });

    await expect(
      grove.acquire({
        leaseId: "fail-checkout",
        mode: "branch",
        branch: "does-not-exist",
      }),
    ).rejects.toThrow(/Branch not found/);

    const leases = await grove.list();
    expect(leases).toHaveLength(1);
    expect(leases[0]?.leaseId).toBe("fail-checkout");
    expect(leases[0]?.state).toBe("quarantined");
    expect(leases[0]?.pendingAcquire).toBeDefined();
  });

  it("branch reuse requires an explicit opt-in", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    await execa("git", ["branch", "existing-branch", "main"], { cwd: repoDir });

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });

    await expect(
      grove.acquire({
        leaseId: "existing-fail",
        mode: "branch",
        branch: "existing-branch",
        createBranch: { from: "main", ifExists: "fail" },
      }),
    ).rejects.toMatchObject({ code: "BRANCH_EXISTS" });

    const failed = await grove.inspect("existing-fail");
    expect(failed?.state).toBe("quarantined");

    const reused = await grove.acquire({
      leaseId: "existing-reuse",
      mode: "branch",
      branch: "existing-branch",
      createBranch: { from: "main", ifExists: "reuse" },
    });
    expect(reused).toMatchObject({ leaseId: "existing-reuse", state: "leased" });
  });

  it("repair resume-acquire completes a quarantined pending acquire", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });

    await expect(
      grove.acquire({
        leaseId: "resume-lease",
        mode: "branch",
        branch: "missing-branch",
      }),
    ).rejects.toThrow(/Branch not found/);

    await execa("git", ["branch", "missing-branch", "main"], { cwd: repoDir });

    const repaired = await grove.repair({
      leaseId: "resume-lease",
      action: "resume-acquire",
    });
    expect(repaired).toMatchObject({ state: "leased", branch: "missing-branch" });
  });

  it("inspect reports missing path without mutating lease state", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "inspect-lease",
      mode: "detached",
      ref: "main",
    });

    await rm(lease.path, { recursive: true, force: true });

    const inspected = await grove.inspect("inspect-lease");
    expect(inspected?.diagnostics?.missingPath).toBe(true);
    expect(inspected?.state).toBe("leased");

    const listed = await grove.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.diagnostics?.missingPath).toBe(true);
  });

  it("idempotent acquire rejects incompatible detached ref", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);
    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });

    // Create a new branch 'other'
    await execa("git", ["branch", "other", "main"], { cwd: repoDir });

    await grove.acquire({
      leaseId: "detached-lease",
      mode: "detached",
      ref: "main",
    });

    await expect(
      grove.acquire({
        leaseId: "detached-lease",
        mode: "detached",
        ref: "other",
        ifLeased: "return-existing",
      }),
    ).rejects.toThrow(/does not match existing detached base or SHA/);
  });
});
