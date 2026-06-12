import { describe, it, expect } from "vitest";
import { execa } from "execa";
import { rm } from "node:fs/promises";
import { createTestGrove } from "./helpers/test-grove.js";
import { setupRepo } from "./helpers/git-repo.js";
import { registerLeaseIntegrationCleanup } from "./helpers/lease-integration.js";

describe("lease acquire integration", () => {
  const cleanup = registerLeaseIntegrationCleanup();

  it("reacquire allows commits made inside the leased branch worktree", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });

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

  it("acquire idempotency for leases", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });

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

  it("failed checkout quarantines lease and preserves pendingAcquire for repair", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });

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
    cleanup.tmpDirs.push(tmpDir);

    await execa("git", ["branch", "existing-branch", "main"], { cwd: repoDir });

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });

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

  it("inspect reports missing path without mutating lease state", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
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
    cleanup.tmpDirs.push(tmpDir);
    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });

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

  it("rejects invalid leaseId before mutating pool state", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });

    await expect(
      grove.acquire({
        leaseId: "bad id!",
        mode: "branch",
        branch: "invalid-lease-id-branch",
        createBranch: { from: "main", ifExists: "fail" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    expect(await grove.list()).toEqual([]);
  });
});
