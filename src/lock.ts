import { lock, type LockOptions } from "proper-lockfile";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LockFailedError } from "./errors.js";

export async function withStateLock<T>(
  groveDir: string,
  fn: () => Promise<T>,
  opts?: LockOptions,
): Promise<T> {
  await mkdir(groveDir, { recursive: true });
  const lockTarget = join(groveDir, "grove-state.lock");
  await writeFile(lockTarget, "", { flag: "a" });

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
