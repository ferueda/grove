import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const MUTATOR_FILES = [
  "lease-acquire.ts",
  "lease-release.ts",
  "lease-destroy.ts",
  "lease-repair.ts",
  "pool-state.ts",
] as const;

const DIRECT_STATE_ASSIGNMENT = /\.state\s*=(?!=)/;

describe("lease-first mutator enforcement", () => {
  it.each(MUTATOR_FILES)("does not assign lease or slot state directly in %s", (file) => {
    const source = readFileSync(join(import.meta.dirname, "..", "src", file), "utf8");
    const violations = source
      .split("\n")
      .map((line, index) => ({ line: line.trimEnd(), number: index + 1 }))
      .filter(({ line }) => DIRECT_STATE_ASSIGNMENT.test(line));

    expect(violations, `use transitionLease/transitionSlot in ${file}`).toEqual([]);
  });
});
