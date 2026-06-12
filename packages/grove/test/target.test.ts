import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupRepo } from "./helpers/git-repo.js";
import { buildAcquireTarget } from "../src/target.js";
import { validateBranchName } from "../src/git/branch.js";
import { InvalidInputError } from "../src/errors.js";
import { rm } from "node:fs/promises";

describe("lease target resolution", () => {
  let tmpDir: string;
  let repoDir: string;

  beforeEach(async () => {
    const setup = await setupRepo();
    tmpDir = setup.tmpDir;
    repoDir = setup.repoDir;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("validates branch names with git check-ref-format", async () => {
    await expect(validateBranchName(repoDir, "agent/job-1")).resolves.toBeUndefined();
    await expect(validateBranchName(repoDir, "bad branch")).rejects.toThrowError(InvalidInputError);
  });

  it("builds detached targets with resolved SHA", async () => {
    const target = await buildAcquireTarget(
      { leaseId: "job-1", mode: "detached", ref: "main" },
      repoDir,
    );
    expect(target.mode).toBe("detached");
    expect(target.requestedRef).toBe("main");
    expect(target.resolvedRefSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("omits SHA fields when reusing a branch that does not exist yet", async () => {
    const target = await buildAcquireTarget(
      { leaseId: "job-1", mode: "branch", branch: "agent/not-created" },
      repoDir,
    );
    expect(target).toEqual({
      mode: "branch",
      branch: "agent/not-created",
      requestedRef: "agent/not-created",
    });
  });

  it("builds branch targets with createFrom metadata", async () => {
    const target = await buildAcquireTarget(
      {
        leaseId: "job-1",
        mode: "branch",
        branch: "agent/job-1",
        createBranch: { from: "main", ifExists: "fail" },
      },
      repoDir,
    );
    expect(target).toMatchObject({
      mode: "branch",
      createFromRef: "main",
    });
    expect(target.mode === "branch" && target.createFromSha).toMatch(/^[0-9a-f]{40}$/);
  });
});
