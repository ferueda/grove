import { describe, it, expect } from "vitest";
import { execa } from "execa";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createTestGrove } from "./helpers/test-grove.js";
import { setupRepo } from "./helpers/git-repo.js";
import { registerLeaseIntegrationCleanup } from "./helpers/lease-integration.js";
import { readLeaseFirstState, writeLeaseFirstState } from "../src/state-v1.js";
import { destroyLease } from "../src/lease-destroy.js";

function writeMarkerHook(markerPath: string): string {
  const script = "require('node:fs').writeFileSync(process.argv[1], 'ran')";
  return ["node", "-e", JSON.stringify(script), JSON.stringify(markerPath)].join(" ");
}

async function gitWorktreePaths(repoDir: string): Promise<string[]> {
  const { stdout } = await execa("git", ["worktree", "list", "--porcelain", "-z"], {
    cwd: repoDir,
  });
  return stdout
    .split("\0")
    .filter((field) => field.startsWith("worktree "))
    .map((field) => field.slice("worktree ".length));
}

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

  it("blocks destroy before preDestroy when a process uses the owned slot directory", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const markerPath = join(tmpDir, "pre-destroy-ran.txt");
    const grove = await createTestGrove({
      repoRoot: repoDir,
      groveRoot: groveDir,
      onHookFailure: "fail",
      hooks: { preDestroy: [writeMarkerHook(markerPath)] },
    });
    const lease = await grove.acquire({
      leaseId: "slot-root-safety",
      mode: "branch",
      branch: "slot-root-safety-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    const state = await readLeaseFirstState(grove.poolDir);
    state.slots[0]!.ownerPid = undefined;
    state.slots[0]!.ownerStartedAt = undefined;
    await writeLeaseFirstState(grove.poolDir, state);

    const siblingPath = join(dirname(lease.path), "worker-cache");
    await mkdir(siblingPath);
    const child = execa(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: siblingPath,
      reject: false,
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });

    try {
      await expect(grove.destroy(lease.leaseId)).rejects.toMatchObject({
        code: "UNSAFE_CLEANUP",
      });
      expect(existsSync(markerPath)).toBe(false);
      expect(existsSync(lease.path)).toBe(true);
      expect(await grove.inspect(lease.leaseId)).toMatchObject({ state: "quarantined" });
    } finally {
      child.kill("SIGTERM");
      await child;
    }
  });

  it("blocks destroy when preDestroy starts a process in the owned slot directory", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "post-hook-slot-root-safety",
      mode: "branch",
      branch: "post-hook-slot-root-safety-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });
    const state = await readLeaseFirstState(grove.poolDir);
    state.slots[0]!.ownerPid = undefined;
    state.slots[0]!.ownerStartedAt = undefined;
    await writeLeaseFirstState(grove.poolDir, state);

    const siblingPath = join(dirname(lease.path), "hook-worker-cache");
    await mkdir(siblingPath);
    let stopChild = async (): Promise<void> => {};
    try {
      await expect(
        destroyLease(grove.poolDir, { repoRoot: repoDir }, lease.leaseId, undefined, {
          preDestroy: async () => {
            const child = execa(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
              cwd: siblingPath,
              reject: false,
            });
            stopChild = async () => {
              child.kill("SIGTERM");
              await child;
            };
            await new Promise<void>((resolve, reject) => {
              child.once("spawn", resolve);
              child.once("error", reject);
            });
          },
        }),
      ).rejects.toMatchObject({ code: "UNSAFE_CLEANUP" });

      expect(existsSync(lease.path)).toBe(true);
      expect(await grove.inspect(lease.leaseId)).toMatchObject({ state: "quarantined" });
    } finally {
      await stopChild();
    }
  });

  it.each(["present", "absent"] as const)(
    "resumes destroy when the checkout is missing and Git registration is %s",
    async (registration) => {
      const { repoDir, tmpDir, groveDir } = await setupRepo();
      cleanup.tmpDirs.push(tmpDir);

      const grove = await createTestGrove({
        repoRoot: repoDir,
        groveRoot: groveDir,
        onHookFailure: "fail",
        hooks: { preDestroy: ["exit 1"] },
      });
      const lease = await grove.acquire({
        leaseId: `missing-checkout-${registration}`,
        mode: "branch",
        branch: `missing-checkout-${registration}-branch`,
        createBranch: { from: "main", ifExists: "fail" },
      });

      const state = await readLeaseFirstState(grove.poolDir);
      state.leases[0]!.state = "destroying";
      state.slots[0]!.state = "destroying";
      state.slots[0]!.ownerPid = process.pid;
      await writeLeaseFirstState(grove.poolDir, state);

      if (registration === "present") {
        await rm(lease.path, { recursive: true, force: true });
      } else {
        await execa("git", ["worktree", "remove", "--force", "--", lease.path], {
          cwd: repoDir,
        });
      }

      await grove.destroy(lease.leaseId, { force: true });

      expect(await grove.inspect(lease.leaseId)).toBeNull();
      expect(existsSync(dirname(lease.path))).toBe(false);
      expect(await gitWorktreePaths(repoDir)).not.toContain(lease.path);
    },
  );

  it("resumes missing-checkout destroy through a symlinked pool path", async () => {
    const { repoDir, tmpDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const physicalRoot = join(tmpDir, "physical-grove");
    const linkedRoot = join(tmpDir, "linked-grove");
    await mkdir(physicalRoot);
    await symlink(physicalRoot, linkedRoot, process.platform === "win32" ? "junction" : "dir");

    const grove = await createTestGrove({
      repoRoot: repoDir,
      groveDir: join(linkedRoot, "pool"),
      onHookFailure: "fail",
      hooks: { preDestroy: ["exit 1"] },
    });
    const lease = await grove.acquire({
      leaseId: "symlinked-missing-checkout",
      mode: "branch",
      branch: "symlinked-missing-checkout-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });
    const physicalLeasePath = await realpath(lease.path);

    const state = await readLeaseFirstState(grove.poolDir);
    state.leases[0]!.state = "destroying";
    state.slots[0]!.state = "destroying";
    state.slots[0]!.ownerPid = process.pid;
    await writeLeaseFirstState(grove.poolDir, state);
    await rm(lease.path, { recursive: true, force: true });

    await grove.destroy(lease.leaseId, { force: true });

    expect(await grove.inspect(lease.leaseId)).toBeNull();
    expect(existsSync(dirname(lease.path))).toBe(false);
    expect(await gitWorktreePaths(repoDir)).not.toContain(physicalLeasePath);
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
