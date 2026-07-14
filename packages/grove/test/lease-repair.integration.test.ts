import { describe, it, expect } from "vitest";
import { execa } from "execa";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestGrove } from "./helpers/test-grove.js";
import { setupRepo } from "./helpers/git-repo.js";
import { registerLeaseIntegrationCleanup } from "./helpers/lease-integration.js";
import { repairLease } from "../src/lease-repair.js";

async function markLeasePreparing(statePath: string, postCreatePending: boolean): Promise<void> {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const lease = state.leases[0];
  lease.pendingAcquire = {
    target: lease.target,
    startedAt: lease.updatedAt,
    postCreatePending,
  };
  lease.state = "preparing";
  delete lease.target;
  delete lease.acquiredHeadSha;
  delete lease.currentHeadSha;
  await writeFile(statePath, JSON.stringify(state));
}

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

  it("repair force-destroy preserves caller force intent after preDestroy", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "force-intent-lease",
      mode: "branch",
      branch: "force-intent-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });
    await grove.release(lease.leaseId, { cleanup: "quarantine" });

    let stopChild = async (): Promise<void> => {};
    try {
      await expect(
        repairLease(
          grove.poolDir,
          { repoRoot: repoDir },
          { leaseId: lease.leaseId, action: "force-destroy" },
          {
            preDestroy: async (wtPath) => {
              const child = execa("node", ["-e", "setInterval(() => {}, 1000)"], {
                cwd: wtPath,
              });
              stopChild = async () => {
                child.kill();
                await child.catch(() => {});
              };
              await new Promise((resolve) => setTimeout(resolve, 500));
            },
          },
        ),
      ).rejects.toMatchObject({ code: "UNSAFE_CLEANUP" });

      expect(await grove.inspect(lease.leaseId)).toMatchObject({ state: "quarantined" });
      expect(existsSync(lease.path)).toBe(true);

      const result = await grove.repair({
        leaseId: lease.leaseId,
        action: "force-destroy",
        force: true,
      });
      expect(result).toEqual({ status: "destroyed", leaseId: lease.leaseId });
      expect(await grove.inspect(lease.leaseId)).toBeNull();
      expect(existsSync(lease.path)).toBe(false);
    } finally {
      await stopChild();
    }
  });

  it("repair resume-acquire completes a preparing lease without replaying postCreate", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const firstLease = await grove.acquire({
      leaseId: "preparing-slot-source",
      mode: "detached",
      ref: "main",
    });
    await grove.release(firstLease.leaseId, {
      cleanup: "reset",
      resetTo: "main",
      force: true,
    });

    const lease = await grove.acquire({
      leaseId: "preparing-resume",
      mode: "branch",
      branch: "preparing-resume-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });
    expect(lease.slotName).toBe(firstLease.slotName);
    await markLeasePreparing(join(grove.poolDir, "grove-state.json"), false);

    let postCreateRuns = 0;
    const repaired = await repairLease(
      grove.poolDir,
      { repoRoot: repoDir },
      { leaseId: lease.leaseId, action: "resume-acquire" },
      { postCreate: async () => void postCreateRuns++ },
    );

    expect(repaired).toMatchObject({
      state: "leased",
      branch: "preparing-resume-branch",
      pendingAcquire: undefined,
    });
    expect(postCreateRuns).toBe(0);
  });

  it("repair resume-acquire recreates a missing worktree and replays postCreate", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "preparing-post-create",
      mode: "branch",
      branch: "preparing-post-create-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });
    await execa("git", ["worktree", "remove", "--force", lease.path], { cwd: repoDir });
    await markLeasePreparing(join(grove.poolDir, "grove-state.json"), false);

    let postCreateRuns = 0;
    const repaired = await repairLease(
      grove.poolDir,
      { repoRoot: repoDir },
      { leaseId: lease.leaseId, action: "resume-acquire" },
      { postCreate: async () => void postCreateRuns++ },
    );

    expect(repaired).toMatchObject({
      state: "leased",
      branch: "preparing-post-create-branch",
      pendingAcquire: undefined,
    });
    expect(postCreateRuns).toBe(1);
    expect(existsSync(lease.path)).toBe(true);
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
