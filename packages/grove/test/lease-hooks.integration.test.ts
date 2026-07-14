import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestGrove } from "./helpers/test-grove.js";
import { setupRepo } from "./helpers/git-repo.js";
import { failOnceHook, registerLeaseIntegrationCleanup } from "./helpers/lease-integration.js";
import { releaseLease } from "../src/lease-release.js";
import * as hooksModule from "../src/hooks.js";

describe("lease hooks integration", () => {
  const cleanup = registerLeaseIntegrationCleanup();

  it("postAcquire hook failure does not quarantine a leased acquire", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({
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
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({
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
      pendingAcquire: expect.objectContaining({ postCreatePending: true }),
      diagnostics: { failedPhase: "postCreate" },
    });
  });

  it("repair resume-acquire reruns a failed postCreate hook", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const attemptsPath = join(tmpDir, "post-create-attempts.txt");
    const hook = failOnceHook(attemptsPath);

    const grove = await createTestGrove({
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
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({
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
    cleanup.tmpDirs.push(tmpDir);

    const attemptsPath = join(tmpDir, "pre-release-attempts.txt");
    const grove = await createTestGrove({
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

  it("runHook does not swallow unexpected hook failures when onHookFailure is fail", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const runHooksSpy = vi
      .spyOn(hooksModule, "runHooks")
      .mockRejectedValueOnce(new Error("boom"));

    try {
      const grove = await createTestGrove({
        repoRoot: repoDir,
        groveRoot: groveDir,
        onHookFailure: "fail",
        hooks: {
          preRelease: ["exit 0"],
        },
      });

      const lease = await grove.acquire({
        leaseId: "unexpected-hook-fail",
        mode: "branch",
        branch: "unexpected-hook-fail-branch",
        createBranch: { from: "main", ifExists: "fail" },
      });

      await expect(grove.release(lease.leaseId, { cleanup: "preserve" })).rejects.toThrow("boom");
    } finally {
      runHooksSpy.mockRestore();
    }
  });

  it("releaseLease propagates unexpected injected preRelease hook failures", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const lease = await grove.acquire({
      leaseId: "injected-hook-fail",
      mode: "branch",
      branch: "injected-hook-fail-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    await expect(
      releaseLease(
        grove.poolDir,
        { repoRoot: repoDir, fetchOnAcquire: false },
        lease.leaseId,
        { cleanup: "preserve" },
        {
          preRelease: async () => {
            throw new Error("boom");
          },
        },
      ),
    ).rejects.toThrow("boom");
  });

  it("postRelease hook failure surfaces after release state is finalized", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    cleanup.tmpDirs.push(tmpDir);

    const grove = await createTestGrove({
      repoRoot: repoDir,
      groveRoot: groveDir,
      onHookFailure: "fail",
      hooks: {
        postRelease: ["exit 1"],
      },
    });

    const lease = await grove.acquire({
      leaseId: "post-release-fail",
      mode: "branch",
      branch: "post-release-fail-branch",
      createBranch: { from: "main", ifExists: "fail" },
    });

    await expect(grove.release(lease.leaseId, { cleanup: "preserve" })).rejects.toMatchObject({
      code: "HOOK_FAILED",
    });

    expect(await grove.inspect("post-release-fail")).toMatchObject({
      leaseId: "post-release-fail",
      state: "leased",
      pendingCleanup: undefined,
    });
  });
});
