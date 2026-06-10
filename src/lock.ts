import { lock } from 'proper-lockfile';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LockFailedError } from './errors.js';

export async function withStateLock<T>(groveDir: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(groveDir, { recursive: true });
  const lockTarget = join(groveDir, 'grove-state.lock');
  await writeFile(lockTarget, '', { flag: 'a' });

  let release: () => Promise<void>;
  try {
    release = await lock(lockTarget, { retries: { retries: 5, minTimeout: 50, maxTimeout: 500 } }); 
  } catch (err: any) {
    throw new LockFailedError(err.message);
  }

  try {
    return await fn();
  } finally {
    await release();
  }
}
