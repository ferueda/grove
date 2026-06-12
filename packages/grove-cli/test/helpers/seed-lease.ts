import { createTestGrove } from "../../../grove/test/helpers/test-grove.js";
import type { AcquireLeaseOptions } from "../../../grove/src/types.js";

/** Seed pool state through the SDK; CLI tests run only the command under test. */
export async function seedLease(
  repoDir: string,
  groveDir: string,
  options: AcquireLeaseOptions,
): Promise<void> {
  const grove = await createTestGrove({ repoRoot: repoDir, groveDir });
  await grove.acquire(options);
}
