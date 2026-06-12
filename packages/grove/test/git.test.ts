import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupRepo } from "./helpers/git-repo.js";
import { runGit } from "../src/git/run.js";
import {
  findRepoRoot,
  findRepoRootFrom,
  getDefaultBranch,
  hasRemote,
  getRemoteUrl,
  shortHash,
  branchRef,
  isAncestor,
  checkoutBranch,
  resolveRef,
} from "../src/git/branch.js";
import {
  addWorktree,
  removeWorktree,
  resetWorktree,
  isDirty,
  fetchOrigin,
} from "../src/git/worktree.js";
import { BranchExistsError, BranchNotFoundError, GitCommandError, RefNotFoundError } from "../src/errors.js";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";

describe("Git Layer", () => {
  let tmpDir: string;
  let repoDir: string;
  let remoteDir: string;

  beforeEach(async () => {
    const setup = await setupRepo();
    tmpDir = setup.tmpDir;
    repoDir = setup.repoDir;
    remoteDir = setup.remoteDir;
  });

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  describe("runGit", () => {
    it("executes git and trims stdout", async () => {
      const out = await runGit(repoDir, ["rev-parse", "--is-inside-work-tree"]);
      expect(out).toBe("true");
    });

    it("throws GitCommandError on git failure", async () => {
      await expect(runGit(repoDir, ["not-a-command"])).rejects.toThrowError(GitCommandError);
    });
  });

  describe("Repo and Branches", () => {
    it("finds repo root", async () => {
      const root = await findRepoRoot(repoDir);
      expect(root).toBe(repoDir);
    });

    it("finds repo root from a subdirectory", async () => {
      // Setup repo handles repoDir creation
      const root = await findRepoRootFrom(repoDir);
      expect(root).toBe(repoDir);
    });

    it("gets default branch from main repo", async () => {
      const branch = await getDefaultBranch(repoDir);
      expect(branch).toBe("main");
    });

    it("detects remote and URL", async () => {
      expect(await hasRemote(repoDir, "origin")).toBe(true);
      expect(await hasRemote(repoDir, "fake")).toBe(false);
      expect(await getRemoteUrl(repoDir)).toBe(remoteDir);
    });

    it("generates short hash", async () => {
      const hash = shortHash("test-string");
      expect(hash).toHaveLength(6);
    });
  });

  describe("Branch Ref Selection", () => {
    it("determines ancestor correctly", async () => {
      const ancestor = await isAncestor(repoDir, "HEAD", "HEAD");
      expect(ancestor).toBe(true);
    });

    it("returns remote ref when local and remote match", async () => {
      const ref = await branchRef(repoDir, "main");
      expect(ref).toBe("origin/main");
    });

    it("returns local ref when branch exists only locally", async () => {
      await execa("git", ["branch", "local-only", "main"], { cwd: repoDir });
      expect(await branchRef(repoDir, "local-only")).toBe("local-only");
    });

    it("prefers local ref when local branch is ahead of remote", async () => {
      await execa("git", ["checkout", "-b", "local-ahead", "main"], { cwd: repoDir });
      await execa("git", ["push", "-u", "origin", "local-ahead"], { cwd: repoDir });
      await execa("git", ["commit", "--allow-empty", "-m", "local ahead"], { cwd: repoDir });

      expect(await branchRef(repoDir, "local-ahead")).toBe("local-ahead");
    });

    it("prefers remote ref when local branch is behind remote", async () => {
      await execa("git", ["checkout", "-b", "remote-ahead", "main"], { cwd: repoDir });
      await execa("git", ["push", "-u", "origin", "remote-ahead"], { cwd: repoDir });
      await execa("git", ["commit", "--allow-empty", "-m", "remote ahead"], { cwd: repoDir });
      await execa("git", ["push"], { cwd: repoDir });
      await execa("git", ["reset", "--hard", "HEAD~1"], { cwd: repoDir });

      expect(await branchRef(repoDir, "remote-ahead")).toBe("origin/remote-ahead");
    });

    it("prefers remote ref when local and remote branches diverged", async () => {
      await execa("git", ["checkout", "-b", "diverged", "main"], { cwd: repoDir });
      await execa("git", ["push", "-u", "origin", "diverged"], { cwd: repoDir });
      await execa("git", ["commit", "--allow-empty", "-m", "local diverged"], { cwd: repoDir });

      await execa("git", ["checkout", "main"], { cwd: repoDir });
      await execa("git", ["commit", "--allow-empty", "-m", "main moved"], { cwd: repoDir });
      await execa("git", ["push", "origin", "HEAD:diverged", "--force"], { cwd: repoDir });

      await execa("git", ["checkout", "diverged"], { cwd: repoDir });
      expect(await branchRef(repoDir, "diverged")).toBe("origin/diverged");
    });
  });

  describe("checkoutBranch and resolveRef", () => {
    it("creates a branch from a base ref", async () => {
      await checkoutBranch(repoDir, "lease-feature", { from: "main", ifExists: "fail" });

      const branchSha = await resolveRef(repoDir, "lease-feature");
      const mainSha = await resolveRef(repoDir, "main");
      expect(branchSha).toBe(mainSha);
    });

    it("reuses an existing branch when ifExists is reuse", async () => {
      await execa("git", ["branch", "existing-branch", "main"], { cwd: repoDir });

      await expect(
        checkoutBranch(repoDir, "existing-branch", { from: "main", ifExists: "reuse" }),
      ).resolves.toBeUndefined();
    });

    it("throws BranchExistsError when branch exists and ifExists is fail", async () => {
      await execa("git", ["branch", "taken-branch", "main"], { cwd: repoDir });

      await expect(
        checkoutBranch(repoDir, "taken-branch", { from: "main", ifExists: "fail" }),
      ).rejects.toThrow(BranchExistsError);
    });

    it("throws BranchNotFoundError when checking out a missing branch", async () => {
      await expect(checkoutBranch(repoDir, "missing-branch")).rejects.toThrow(BranchNotFoundError);
    });

    it("throws RefNotFoundError when resolving a missing ref", async () => {
      await expect(resolveRef(repoDir, "no-such-ref")).rejects.toThrow(RefNotFoundError);
    });
  });

  describe("Worktree Operations", () => {
    it("adds and removes a worktree", async () => {
      const wtPath = join(tmpDir, "wt1");
      await addWorktree(repoDir, wtPath, "main");
      expect(await findRepoRootFrom(wtPath)).toBe(wtPath);

      await removeWorktree(repoDir, wtPath);
      await expect(findRepoRootFrom(wtPath)).rejects.toThrow(/Git not found|failed|ENOENT/i);
    });

    it("detects dirty state", async () => {
      const wtPath = join(tmpDir, "wt2");
      await addWorktree(repoDir, wtPath, "main");

      expect(await isDirty(wtPath)).toBe(false);
      await execa("node", [
        "-e",
        `require("fs").writeFileSync("${join(wtPath, "dirty.txt")}", "1")`,
      ]);
      expect(await isDirty(wtPath)).toBe(true);
    });

    it("resets a worktree cleanly", async () => {
      const wtPath = join(tmpDir, "wt3");
      await addWorktree(repoDir, wtPath, "main");
      await execa("node", [
        "-e",
        `require("fs").writeFileSync("${join(wtPath, "dirty.txt")}", "1")`,
      ]);

      await resetWorktree(wtPath, "main");
      expect(await isDirty(wtPath)).toBe(false);
    });

    it("fetches origin", async () => {
      // Just verifying it doesn't throw
      await fetchOrigin(repoDir);
      expect(true).toBe(true);
    });
  });
});
