import { describe, it, expect, afterEach, vi } from "vitest";
import { createGrove } from "../src/index.js";
import { createTestGrove } from "./helpers/test-grove.js";
import { setupRepo } from "./helpers/git-repo.js";
import * as worktree from "../src/git/worktree.js";
import { rm } from "node:fs/promises";

describe("acquire fetch policy", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("fetches origin at most once when GroveConfig fetchOnAcquire defaults to true", async () => {
    const setup = await setupRepo();
    tmpDir = setup.tmpDir;
    const fetchSpy = vi.spyOn(worktree, "fetchOrigin").mockResolvedValue(undefined);

    const grove = await createGrove({
      repoRoot: setup.repoDir,
      groveRoot: setup.groveDir,
    });
    await grove.acquire({
      leaseId: "fetch-once",
      mode: "detached",
      ref: "main",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(setup.repoDir);
  });

  it("skips fetch when fetchOnAcquire is false at the public boundary", async () => {
    const setup = await setupRepo();
    tmpDir = setup.tmpDir;
    const fetchSpy = vi.spyOn(worktree, "fetchOrigin").mockResolvedValue(undefined);

    const grove = await createTestGrove({
      repoRoot: setup.repoDir,
      groveRoot: setup.groveDir,
    });
    await grove.acquire({
      leaseId: "no-fetch",
      mode: "detached",
      ref: "main",
      fetchOnAcquire: false,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
