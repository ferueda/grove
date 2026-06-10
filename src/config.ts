import { join, basename, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { getRemoteUrl, shortHash } from './git/index.js';

function expandEnv(str: string): string {
  return str.replace(/\$(?:{([A-Za-z_][A-Za-z0-9_]*)}|([A-Za-z_][A-Za-z0-9_]*))/g, (_, n1, n2) => {
    const name = n1 || n2 || '';
    return process.env[name] || '';
  });
}

export async function resolveGroveDir(repoRoot: string, root: string): Promise<string> {
  let hashInput = repoRoot;
  try {
    hashInput = await getRemoteUrl(repoRoot);
  } catch {}

  const repoName = basename(repoRoot);
  const hash = shortHash(hashInput);
  const poolName = `${repoName}-${hash}`;

  if (!root) {
    return join(homedir(), '.grove', poolName);
  }

  let expanded = expandEnv(root);
  if (!isAbsolute(expanded)) {
    expanded = join(repoRoot, expanded);
  }
  
  return join(expanded, '.grove', poolName);
}
