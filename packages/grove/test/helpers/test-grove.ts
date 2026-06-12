import { createGrove } from "../../src/index.js";
import type { GroveConfig } from "../../src/schemas.js";

/** Integration-test Grove with fetch disabled unless a test opts in explicitly. */
export async function createTestGrove(config: GroveConfig) {
  return createGrove({
    ...config,
    fetchOnAcquire: config.fetchOnAcquire ?? false,
  });
}
