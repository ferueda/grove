import { execa } from "execa";
import { createGrove } from "@ferueda/grove";
import type { Grove } from "@ferueda/grove";

export type GroveCliContext = {
  grove: Grove;
  repoRoot: string;
  groveDir: string;
};

export async function findRepoRoot(cwd: string = process.cwd()): Promise<string> {
  try {
    const { stdout } = await execa("git", ["rev-parse", "--show-toplevel"], { cwd });
    return stdout.trim();
  } catch {
    throw new Error(`Directory ${cwd} is not inside a git repository`);
  }
}

export async function loadGroveContext(options: {
  repo?: string;
  dir?: string;
}): Promise<GroveCliContext> {
  let repoRoot = options.repo || process.env.GROVE_REPO_ROOT;
  if (!repoRoot) {
    repoRoot = await findRepoRoot();
  }
  const groveDir = options.dir || process.env.GROVE_DIR;
  const grove = await createGrove({ repoRoot, groveDir });
  return { grove, repoRoot, groveDir: grove.poolDir };
}

export async function loadGrove(options: { repo?: string; dir?: string }): Promise<Grove> {
  return (await loadGroveContext(options)).grove;
}
