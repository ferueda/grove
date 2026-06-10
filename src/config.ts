import { join, basename, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { remoteUrl, shortHash } from './git/index.js';

function expandEnv(str: string): string {
  return str.replace(/\$([A-Z_]+)/g, (_, n) => process.env[n] || '');
}

export async function resolveGroveDir(repoRoot: string, root: string): Promise<string> {
  let hashInput = repoRoot;
  try {
    hashInput = await remoteUrl(repoRoot);
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
