import { isAbsolute, relative } from "node:path";
import { realpath } from "node:fs/promises";
import { PathOutsidePoolError } from "./errors.js";

export async function assertPathWithinPool(poolDir: string, targetPath: string): Promise<void> {
  const poolReal = await realpath(poolDir);
  let targetReal = targetPath;
  try {
    targetReal = await realpath(targetPath);
  } catch {
    // Target may not exist yet; use the configured path for boundary checks.
  }

  const rel = relative(poolReal, targetReal);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new PathOutsidePoolError("Security violation: target path is outside the pool boundary");
  }
}
