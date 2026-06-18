import { describe, it, expect } from "vitest";
import { exitCodeForError } from "../src/exit-codes.js";

describe("exitCodeForError", () => {
  const cases: Array<{ code: string; exitCode: number }> = [
    { code: "INVALID_INPUT", exitCode: 2 },
    { code: "LEASE_CONFLICT", exitCode: 3 },
    { code: "LEASE_ALREADY_EXISTS", exitCode: 3 },
    { code: "GROVE_EXHAUSTED", exitCode: 4 },
    { code: "POOL_EXHAUSTED", exitCode: 4 },
    { code: "GIT_NOT_FOUND", exitCode: 5 },
    { code: "GIT_COMMAND_FAILED", exitCode: 5 },
    { code: "LOCK_FAILED", exitCode: 6 },
    { code: "UNSAFE_CLEANUP", exitCode: 7 },
    { code: "PROCESS_SAFETY_UNVERIFIED", exitCode: 7 },
    { code: "WORKTREE_IN_USE", exitCode: 7 },
    { code: "LEASE_NOT_FOUND", exitCode: 8 },
    { code: "WORKTREE_NOT_MANAGED", exitCode: 8 },
    { code: "LEASE_QUARANTINED", exitCode: 9 },
    { code: "LEASE_BUSY", exitCode: 9 },
    { code: "ACQUIRE_IN_PROGRESS", exitCode: 9 },
    { code: "REPAIR_NOT_AVAILABLE", exitCode: 10 },
    { code: "INVALID_TRANSITION", exitCode: 10 },
    { code: "INVALID_GROVE_STATE", exitCode: 11 },
    { code: "PATH_OUTSIDE_POOL", exitCode: 12 },
    { code: "BRANCH_EXISTS", exitCode: 13 },
    { code: "BRANCH_NOT_FOUND", exitCode: 13 },
    { code: "REF_NOT_FOUND", exitCode: 13 },
    { code: "HOOK_FAILED", exitCode: 14 },
  ];

  it.each(cases)("maps $code to exit code $exitCode", ({ code, exitCode }) => {
    expect(exitCodeForError({ code })).toBe(exitCode);
  });

  // Branch/ref lookup failures intentionally share exit category 13.
  describe("branch and ref lookup failures share exit category 13", () => {
    it.each(["BRANCH_EXISTS", "BRANCH_NOT_FOUND", "REF_NOT_FOUND"] as const)(
      "maps %s to exit code 13",
      (code) => {
        expect(exitCodeForError({ code })).toBe(13);
      },
    );
  });

  it("returns 1 for unmapped Grove error codes", () => {
    expect(exitCodeForError({ code: "WORKTREE_DESTROYING" })).toBe(1);
    expect(exitCodeForError({ code: "BRANCH_DELETE_FAILED" })).toBe(1);
  });

  it("returns 1 for errors without a code", () => {
    expect(exitCodeForError(new Error("boom"))).toBe(1);
    expect(exitCodeForError({ message: "no code" })).toBe(1);
    expect(exitCodeForError(null)).toBe(1);
  });
});
