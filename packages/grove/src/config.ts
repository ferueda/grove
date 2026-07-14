import { join, basename, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import { shortHash } from "./git/index.js";

function expandEnv(str: string): string {
  return str.replace(/\$(?:{([A-Za-z_][A-Za-z0-9_]*)}|([A-Za-z_][A-Za-z0-9_]*))/g, (_, n1, n2) => {
    const name = n1 || n2 || "";
    return process.env[name] || "";
  });
}

export async function resolveGroveDir(repoRoot: string, root?: string): Promise<string> {
  const normalizedRepoRoot = resolve(repoRoot);
  const repoName = basename(normalizedRepoRoot);
  const hash = shortHash(normalizedRepoRoot);
  const poolName = `${repoName}-${hash}`;

  if (!root) {
    return join(homedir(), ".grove", poolName);
  }

  let expanded = expandEnv(root);
  if (!isAbsolute(expanded)) {
    expanded = join(repoRoot, expanded);
  }

  return join(expanded, ".grove", poolName);
}
