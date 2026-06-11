import { execa } from "execa";
import { createGrove } from "grove";
import type { Grove } from "grove";

export async function findRepoRoot(cwd: string = process.cwd()): Promise<string> {
  try {
    const { stdout } = await execa("git", ["rev-parse", "--show-toplevel"], { cwd });
    return stdout.trim();
  } catch {
    throw new Error(`Directory ${cwd} is not inside a git repository`);
  }
}

export async function loadGrove(options: { repo?: string; dir?: string }): Promise<Grove> {
  let repoRoot = options.repo;
  if (!repoRoot) {
    repoRoot = await findRepoRoot();
  }
  return createGrove({ repoRoot, groveDir: options.dir });
}
