import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createGrove } from "../src/index.js";
import { setupRepo } from "./helpers/git-repo.js";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

    // Can repair quarantine
    const repaired = await grove.repair({
      leaseId: "repair-lease",
      action: "quarantine"
    });
    expect(repaired?.state).toBe("quarantined");
  });

  it("safe delete branches", async () => {
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

    // Destroy and delete branch
    await grove.destroy(lease.leaseId, { force: true, deleteBranch: true });

    // Check branch is gone
    await expect(execa("git", ["rev-parse", "--verify", "pr/123"], { cwd: repoDir })).rejects.toThrowError(/exit code/);
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
    expect(repaired?.state).toBe("leased");
    expect(repaired?.branch).toBe("missing-branch");
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

    await grove.acquire({ leaseId: "safe-lease", mode: "detached", ref: "main" });
    const lease2 = await grove.acquire({ leaseId: "unsafe-lease", mode: "detached", ref: "main" });

    // Spawn a long-running process in lease2 to make it unsafe
    const p = execa("sleep", ["60"], { cwd: lease2.path });

    // Attempt destroyAll without force
    await expect(grove.destroyAll()).rejects.toThrow(/in use/);

    // Verify NEITHER was destroyed
    const leases = await grove.listLeases();
    expect(leases).toHaveLength(2);
    expect(leases.find(l => l.leaseId === "safe-lease")?.state).toBe("leased");
    expect(leases.find(l => l.leaseId === "unsafe-lease")?.state).toBe("leased");

    p.kill();
    await p.catch(() => {});
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
