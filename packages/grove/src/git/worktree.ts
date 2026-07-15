import { runGit } from "./run.js";
import { branchRef, hasRemote } from "./branch.js";
import { resolvePathWithExistingAncestor } from "../path-boundary.js";

export async function addWorktree(repoRoot: string, path: string, branch: string): Promise<void> {
  const ref = await branchRef(repoRoot, branch);
  await runGit(repoRoot, ["worktree", "add", "--detach", "--", path, ref]);
}

export async function removeWorktree(repoRoot: string, path: string): Promise<void> {
  await runGit(repoRoot, ["worktree", "remove", "--force", "--", path]);
}

async function isWorktreeRegistered(repoRoot: string, path: string): Promise<boolean> {
  const targetPath = await resolvePathWithExistingAncestor(path);
  const output = await runGit(repoRoot, ["worktree", "list", "--porcelain", "-z"]);
  const registeredPaths = output
    .split("\0")
    .filter((field) => field.startsWith("worktree "))
    .map((field) => field.slice("worktree ".length));
  const registeredTargets = await Promise.all(registeredPaths.map(resolvePathWithExistingAncestor));
  return registeredTargets.includes(targetPath);
}

export async function removeWorktreeIfRegistered(repoRoot: string, path: string): Promise<void> {
  if (!(await isWorktreeRegistered(repoRoot, path))) {
    return;
  }
  try {
    await removeWorktree(repoRoot, path);
  } catch (error) {
    if (await isWorktreeRegistered(repoRoot, path)) {
      throw error;
    }
  }
}

export async function resetWorktree(
  path: string,
  branch: string,
  options?: { cleanIgnored?: boolean },
): Promise<void> {
  let repoRoot = path;
  try {
    repoRoot = await runGit(path, ["rev-parse", "--show-toplevel"]);
  } catch {}
  const ref = await branchRef(repoRoot, branch);
  await runGit(path, ["checkout", "--detach", "--force", ref]);
  await runGit(path, ["reset", "--hard", ref]);
  await runGit(path, options?.cleanIgnored ? ["clean", "-fdx"] : ["clean", "-fd"]);
}

export async function detachWorktree(path: string): Promise<void> {
  await runGit(path, ["checkout", "--detach"]);
}

export async function isDirty(path: string): Promise<boolean> {
  const status = await runGit(path, ["status", "--porcelain"]);
  return status.trim().length > 0;
}

export async function fetchOrigin(repoRoot: string): Promise<void> {
  if (await hasRemote(repoRoot, "origin")) {
    await runGit(repoRoot, ["fetch", "origin"]);
  }
}
