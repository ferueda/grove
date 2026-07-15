import { describe, it, expect } from "vitest";
import { execa } from "execa";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestGrove } from "./helpers/test-grove.js";
import { setupRepo } from "./helpers/git-repo.js";
import { registerLeaseIntegrationCleanup } from "./helpers/lease-integration.js";
import { readLeaseFirstState, writeLeaseFirstState } from "../src/state-v1.js";

describe("lease destroy integration", () => {
  const cleanup = registerLeaseIntegrationCleanup();

  it("destroy rejects physical worktree paths and only accepts leaseId", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "path-destroy-lease",
      mode: "branch",
      branch: "path-destroy-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    await expect(grove.destroy(lease.path, { force: true })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(await grove.inspect("path-destroy-lease")).toMatchObject({ state: "leased" });
    expect(existsSync(lease.path)).toBe(true);
  });

  it("destroy rejects paths outside the pool boundary and quarantines the lease", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
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

    await expect(grove.destroy(lease.leaseId, { force: true })).rejects.toMatchObject({
      code: "PATH_OUTSIDE_POOL",
    });

    const quarantined = await grove.inspect("boundary-lease");
    expect(quarantined?.state).toBe("quarantined");
  });

  it("destroy rejects a worktree whose parent is the pool root", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "shallow-layout-lease",
      mode: "branch",
      branch: "shallow-layout-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    const shallowPath = join(grove.poolDir, "repo");
    await execa("git", ["worktree", "move", lease.path, shallowPath], { cwd: repoDir });
    const state = await readLeaseFirstState(grove.poolDir);
    state.slots[0]!.path = shallowPath;
    state.leases[0]!.path = shallowPath;
    await writeLeaseFirstState(grove.poolDir, state);

    const sentinelPath = join(grove.poolDir, "sentinel.txt");
    await writeFile(sentinelPath, "keep");

    await expect(grove.destroy(lease.leaseId, { force: true })).rejects.toMatchObject({
      code: "PATH_OUTSIDE_POOL",
    });
    expect(existsSync(sentinelPath)).toBe(true);
    expect(existsSync(shallowPath)).toBe(true);
    expect(await grove.inspect(lease.leaseId)).toMatchObject({ state: "quarantined" });
  });

  it("idempotent destroy resumes an in-progress destroying lease", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
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
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({
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
});
