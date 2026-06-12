import { createHash } from "node:crypto";
import { runGit } from "./run.js";
import {
  BranchExistsError,
  BranchNotFoundError,
  RefNotFoundError,
  GitCommandError,
  InvalidInputError,
} from "../errors.js";

export async function validateBranchName(repoRoot: string, branch: string): Promise<void> {
  try {
    await runGit(repoRoot, ["check-ref-format", "--branch", branch]);
  } catch {
    throw new InvalidInputError(`Invalid branch name: ${branch}`);
  }
}

export async function findRepoRoot(cwd?: string): Promise<string> {
  return runGit(cwd, ["rev-parse", "--show-toplevel"]);
}

export async function findRepoRootFrom(cwd: string): Promise<string> {
  return findRepoRoot(cwd);
}

export async function getDefaultBranch(repoRoot: string): Promise<string> {
  let mainRoot = repoRoot;
  try {
    let commonDir = await runGit(repoRoot, ["rev-parse", "--git-common-dir"]);
    try {
      commonDir = await runGit(repoRoot, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]);
    } catch {}
    if (commonDir.endsWith(".git")) {
      mainRoot = commonDir.slice(0, -4);
    }
  } catch {}

  try {
    const out = await runGit(mainRoot, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
    return out.replace("refs/remotes/origin/", "");
  } catch {
    // ignore
  }

  try {
    const out = await runGit(mainRoot, ["symbolic-ref", "HEAD"]);
    return out.replace("refs/heads/", "");
  } catch {
    // ignore
  }

  try {
    const out = await runGit(mainRoot, ["config", "init.defaultBranch"]);
    if (out) return out;
  } catch {
    // ignore
  }

  throw new Error(
    "cannot determine default branch: try running 'git fetch' or ensure you are on a branch",
  );
}

export async function hasRemote(repoRoot: string, name: string): Promise<boolean> {
  try {
    const out = await runGit(repoRoot, ["remote"]);
    return out
      .split("\n")
      .map((r) => r.trim())
      .includes(name);
  } catch {
    return false;
  }
}

export async function getRemoteUrl(repoRoot: string): Promise<string> {
  return runGit(repoRoot, ["remote", "get-url", "origin"]);
}

export function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").substring(0, 6);
}

export async function isAncestor(repoRoot: string, a: string, b: string): Promise<boolean> {
  try {
    await runGit(repoRoot, ["merge-base", "--is-ancestor", a, b]);
    return true; // exit code 0 means true
  } catch {
    return false; // exit code 1 means false
  }
}

export async function branchRef(repoRoot: string, branch: string): Promise<string> {
  const local = `refs/heads/${branch}`;
  const remote = `origin/${branch}`;

  let localExists = false;
  try {
    await runGit(repoRoot, ["rev-parse", "--verify", local]);
    localExists = true;
  } catch {}

  let remoteExists = false;
  try {
    await runGit(repoRoot, ["rev-parse", "--verify", remote]);
    remoteExists = true;
  } catch {}

  if (localExists && remoteExists) {
    if (await isAncestor(repoRoot, local, remote)) {
      return remote; // remote is ahead or equal
    }
    if (await isAncestor(repoRoot, remote, local)) {
      return branch; // local is ahead
    }
    return remote; // diverged, prefer remote
  }

  if (localExists) return branch;
  if (remoteExists) return remote;

  return branch; // fallback
}

export async function getHeadSha(wtPath: string): Promise<string> {
  return (await runGit(wtPath, ["rev-parse", "HEAD"])).trim();
}

export async function resolveRef(repoRoot: string, ref: string): Promise<string> {
  try {
    return (await runGit(repoRoot, ["rev-parse", ref])).trim();
  } catch {
    throw new RefNotFoundError(`Ref not found: ${ref}`);
  }
}

export async function checkoutBranch(
  wtPath: string,
  branch: string,
  createOpts?: { from: string; ifExists?: "reuse" | "fail" }
): Promise<void> {
  if (createOpts) {
    const localBranches = await runGit(wtPath, ["branch", "--list", branch]);
    if (localBranches.trim()) {
      if (createOpts.ifExists === "fail") {
        throw new BranchExistsError(`Branch exists: ${branch}`);
      }
      // reuse
      await runGit(wtPath, ["checkout", branch]);
    } else {
      try {
        await runGit(wtPath, ["checkout", "-b", branch, createOpts.from]);
      } catch (err: any) {
        throw new GitCommandError(`Failed to create branch ${branch} from ${createOpts.from}`, err.message);
      }
    }
  } else {
    try {
      await runGit(wtPath, ["checkout", branch]);
    } catch {
      throw new BranchNotFoundError(`Branch not found: ${branch}`);
    }
  }
}

export async function checkoutDetached(wtPath: string, ref: string): Promise<void> {
  try {
    await runGit(wtPath, ["checkout", "--detach", ref]);
  } catch {
    throw new RefNotFoundError(`Ref not found: ${ref}`);
  }
}

export async function deleteBranch(repoRoot: string, branch: string, force?: boolean): Promise<void> {
  try {
    const args = force ? ["branch", "-D", branch] : ["branch", "-d", branch];
    await runGit(repoRoot, args);
  } catch (err: any) {
    throw new GitCommandError(`Failed to delete branch ${branch}`, err.message);
  }
}
