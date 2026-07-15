import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { PathOutsidePoolError } from "./errors.js";

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

export async function resolvePathWithExistingAncestor(targetPath: string): Promise<string> {
  let ancestor = resolve(targetPath);
  const missingSegments: string[] = [];

  while (true) {
    try {
      const ancestorReal = await realpath(ancestor);
      return join(ancestorReal, ...missingSegments.reverse());
    } catch (error) {
      if (!isMissingPathError(error) || dirname(ancestor) === ancestor) {
        throw error;
      }
      missingSegments.push(basename(ancestor));
      ancestor = dirname(ancestor);
    }
  }
}

export async function assertPathWithinPool(poolDir: string, targetPath: string): Promise<void> {
  const [poolReal, targetReal] = await Promise.all([
    realpath(poolDir),
    resolvePathWithExistingAncestor(targetPath),
  ]);

  const rel = relative(poolReal, targetReal);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new PathOutsidePoolError("Security violation: target path is outside the pool boundary");
  }
}
