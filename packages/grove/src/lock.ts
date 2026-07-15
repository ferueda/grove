import { lock, type LockOptions } from "proper-lockfile";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LockFailedError } from "./errors.js";

async function withLock<T>(
  lockTarget: string,
  fn: () => Promise<T>,
  opts?: LockOptions,
): Promise<T> {
  const lockOpts: LockOptions = {
    retries: opts?.retries ?? { retries: 300, minTimeout: 500, maxTimeout: 2000 },
    ...opts,
  };

  let release: () => Promise<void>;
  try {
    release = await lock(lockTarget, lockOpts);
  } catch (err: any) {
    throw new LockFailedError(err.message);
  }

  try {
    return await fn();
  } finally {
    await release();
  }
}

export async function withStateLock<T>(
  groveDir: string,
  fn: () => Promise<T>,
  opts?: LockOptions,
): Promise<T> {
  await mkdir(groveDir, { recursive: true });
  const lockTarget = join(groveDir, "grove-state.lock");
  await writeFile(lockTarget, "", { flag: "a" });

  return withLock(lockTarget, fn, opts);
}

/** Serialize lease hooks that operate on the same active worktree. */
export async function withLeaseHookLock<T>(worktreePath: string, fn: () => Promise<T>): Promise<T> {
  return withLock(worktreePath, fn);
}
