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

  it("legacy signatures are maintained", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });

    const wt1 = await grove.acquire();
    expect(wt1.path).toBeDefined();
    expect(wt1.name).toBeDefined();

    const list1 = await grove.listWorktreeStatus();
    expect(list1).toHaveLength(1);
    expect(list1[0]?.status).toBe("in-use");

    await grove.release(wt1.path);

    const list2 = await grove.listWorktreeStatus();
    expect(list2).toHaveLength(1);
  });

  it("reacquire allows commits made inside the leased branch worktree", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });

    const lease1 = await grove.acquire({
      leaseId: "commit-lease",
      mode: "branch",
      branch: "work-branch",
      createBranch: { from: "main" },
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
        createBranch: { from: "main" },
      }),
    ).rejects.toThrow(/Hook failed/);

    const leases = await grove.listLeases();
    expect(leases).toHaveLength(1);
    expect(leases[0]?.leaseId).toBe("hook-fail-lease");
    expect(leases[0]?.state).toBe("leased");
  });

  it("acquire idempotency for leases", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });

    const lease1 = await grove.acquire({
      leaseId: "test-lease",
      mode: "branch",
      branch: "test-branch-1",
      createBranch: { from: "main" },
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
      })
    ).rejects.toThrow("Lease conflict");

    await expect(
      grove.acquire({
        leaseId: "test-lease",
      mode: "branch",
      branch: "test-branch-1",
      ifLeased: "fail",
      })
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
      createBranch: { from: "main" },
    });

    const scriptPath = join(tmpDir, "sleep.mjs");
    await writeFile(scriptPath, "setInterval(() => {}, 1000);");

    const child = execa("node", [scriptPath], { cwd: lease.path });
    await new Promise((r) => setTimeout(r, 500)); // wait for start

    try {
      await expect(
        grove.release(lease.leaseId, { cleanup: "reset", resetTo: "main" })
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
      createBranch: { from: "main" },
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
      createBranch: { from: "main" },
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
    expect(await grove.listLeases()).toHaveLength(0);
    expect(existsSync(join(lease.path, "untracked.txt"))).toBe(false);

    const slots = await grove.listWorktreeStatus();
    expect(slots.find((slot) => slot.path === lease.path)?.status).toBe("available");
  });

  it("reset preserves ignored files by default and removes them with cleanIgnored", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "clean-lease",
      mode: "branch",
      branch: "clean-branch",
      createBranch: { from: "main" },
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
      createBranch: { from: "main" },
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
      createBranch: { from: "main" },
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
      createBranch: { from: "main" },
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
      createBranch: { from: "main" },
    });

    await grove.release(lease.leaseId, { cleanup: "quarantine" });

    await expect(
      grove.release(lease.leaseId, { cleanup: "preserve" }),
    ).rejects.toMatchObject({ code: "LEASE_QUARANTINED" });
  });

  it("release on busy releasing lease throws LEASE_BUSY", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "busy-release",
      mode: "branch",
      branch: "busy-release-branch",
      createBranch: { from: "main" },
    });

    const statePath = join(grove.poolDir, "grove-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.leases[0].state = "releasing";
    state.leases[0].pendingCleanup = { cleanup: "preserve" };
    await writeFile(statePath, JSON.stringify(state));

    await expect(
      grove.release(lease.leaseId, { cleanup: "preserve" }),
    ).rejects.toMatchObject({ code: "LEASE_BUSY" });
  });

  it("resume-cleanup completes interrupted preserve release", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "resume-cleanup-lease",
      mode: "branch",
      branch: "resume-cleanup-branch",
      createBranch: { from: "main" },
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
      createBranch: { from: "main" },
    });

    // Simulate failure during release (state marked releasing)
    await expect(
      grove.release(lease.leaseId, { cleanup: "reset", resetTo: "invalid-branch", force: true })
    ).rejects.toThrow(/Cleanup failed/);

    const list = await grove.listLeases();
    const l = list.find(x => x.leaseId === "repair-lease");
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
      createBranch: { from: "main" },
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
      createBranch: { from: "main" },
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
      createBranch: { from: "main" },
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
      createBranch: { from: "main" },
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
      createBranch: { from: "main" },
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
      createBranch: { from: "main" },
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
      createBranch: { from: "main" },
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
      createBranch: { from: "main" },
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

  it("destroy rejects paths outside the pool boundary and quarantines the lease", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "boundary-lease",
      mode: "branch",
      branch: "boundary-branch",
      createBranch: { from: "main" },
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
      createBranch: { from: "main" },
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
      createBranch: { from: "main" },
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

    const leases = await grove.listLeases();
    expect(leases).toHaveLength(1);
    expect(leases[0]?.leaseId).toBe("fail-checkout");
    expect(leases[0]?.state).toBe("quarantined");
    expect(leases[0]?.pendingAcquire).toBeDefined();
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

  it("destroyAll is atomic: fails completely if one worktree is unsafe", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);
    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });

    const lease1 = await grove.acquire({ leaseId: "safe-lease", mode: "detached", ref: "main" });
    const lease2 = await grove.acquire({ leaseId: "unsafe-lease", mode: "detached", ref: "main" });

    await grove.release(lease1.leaseId, { cleanup: "preserve" });

    const p = execa("sleep", ["60"], { cwd: lease2.path });
    await new Promise((r) => setTimeout(r, 500));

    try {
      await expect(grove.destroyAll()).rejects.toThrow(/in use/);

      const leases = await grove.listLeases();
      expect(leases).toHaveLength(2);
      expect(leases.find((l) => l.leaseId === "safe-lease")?.state).toBe("leased");
      expect(leases.find((l) => l.leaseId === "unsafe-lease")?.state).toBe("leased");
      expect(existsSync(lease1.path)).toBe(true);
      expect(existsSync(lease2.path)).toBe(true);
    } finally {
      p.kill();
      await p.catch(() => {});
    }
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
      })
    ).rejects.toThrow(/does not match existing detached base or SHA/);
  });


  it("destroyAll happy path: cleans up all idle leases safely", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);
    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });

    const lease1 = await grove.acquire({ leaseId: "lease-1", mode: "detached", ref: "main" });
    const lease2 = await grove.acquire({ leaseId: "lease-2", mode: "detached", ref: "main" });

    // Release them to preserve to clear the owner/PID tracking, making them idle
    await grove.release(lease1.leaseId, { cleanup: "preserve" });
    await grove.release(lease2.leaseId, { cleanup: "preserve" });

    await grove.destroyAll();

    const leases = await grove.listLeases();
    expect(leases).toHaveLength(0);

    const { existsSync } = await import("node:fs");
    expect(existsSync(lease1.path)).toBe(false);
    expect(existsSync(lease2.path)).toBe(false);
  });
});
