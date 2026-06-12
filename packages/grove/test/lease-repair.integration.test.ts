import { describe, it, expect } from "vitest";
import { execa } from "execa";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestGrove } from "./helpers/test-grove.js";
import { setupRepo } from "./helpers/git-repo.js";
import { registerLeaseIntegrationCleanup } from "./helpers/lease-integration.js";

describe("lease repair integration", () => {
  const cleanup = registerLeaseIntegrationCleanup();

  it("repair intent test", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });

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
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
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
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
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
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
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
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
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
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
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
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
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
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
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
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
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

  it("repair resume-acquire completes a quarantined pending acquire", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });

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
});
