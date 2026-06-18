import { describe, it, expect } from "vitest";
import { execa } from "execa";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestGrove } from "./helpers/test-grove.js";
import { setupRepo } from "./helpers/git-repo.js";
import { registerLeaseIntegrationCleanup } from "./helpers/lease-integration.js";

describe("lease release integration", () => {
  const cleanup = registerLeaseIntegrationCleanup();

  it("process safety enforcement during destructive operations", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });

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
      ).rejects.toMatchObject({ code: "UNSAFE_CLEANUP" });

      await expect(grove.destroy(lease.leaseId)).rejects.toMatchObject({ code: "UNSAFE_CLEANUP" });

      // forceful bypass
      await grove.destroy(lease.leaseId, { force: true });
    } finally {
      child.kill();
      await child.catch(() => {});
    }
  });

  it("preserve release keeps dirty files and returns preserved lease", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
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
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
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
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
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
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
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
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
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
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
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
      ).rejects.toMatchObject({ code: "UNSAFE_CLEANUP" });
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
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
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
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
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
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
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

  it("release rejects physical worktree paths and only accepts leaseId", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "path-release-lease",
      mode: "branch",
      branch: "path-release-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    await expect(grove.release(lease.path, { cleanup: "preserve" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(await grove.inspect("path-release-lease")).toMatchObject({ state: "leased" });
  });
});
