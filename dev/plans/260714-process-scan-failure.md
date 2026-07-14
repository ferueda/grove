# Treat failed macOS process scans as unverified

## Goal

Restore the process-safety contract in `VISION.md` and `README.md`: a failed or unavailable macOS `lsof` scan reports `unverified`, so destructive cleanup without `force: true` stops before mutating lease state. Today `findInWorktree()` uses Execa with `reject: false` and parses failed results as a verified empty scan.

Acceptance: failed spawn and nonzero `lsof` results produce `{ processes: [], unverified: true }`; successful output keeps the current parsing behavior; existing forced cleanup behavior remains unchanged.

## Changes

1. `packages/grove/test/lease-release.integration.test.ts` — test first with one focused regression using the real SDK and Git fixture. Acquire a lease, release with `preserve` to clear its owner reservation, then temporarily set `process.platform` to `darwin` and `PATH` to a nonexistent temporary directory inside a `try/finally`. Assert the real `findInWorktree()` result is unverified, a reset release with explicit `resetTo: "main"` fails with `UNSAFE_CLEANUP`, and after restoring both globals the lease is still `leased` and its path still exists. This deterministically exercises unavailable `lsof` on Linux and macOS CI, avoids mocking Git or Execa, and proves cleanup stopped before the write-ahead transition. Keep the existing force-bypass coverage rather than duplicating it.
2. `packages/grove/src/process/detect.ts:findInWorktree` — in the Darwin branch, retain the full Execa result and return the existing empty/unverified result immediately when `result.failed` is true; parse `stdout` only on success. Execa's `failed` flag covers both spawn failures such as `ENOENT` and nonzero exits, avoiding separate status/error branches or a new abstraction. Keep the catch as the fallback for thrown scan errors.

## Verify

- `pnpm vitest run packages/grove/test/lease-release.integration.test.ts`
- `pnpm check`

## Boundaries

- No Linux `/proc` scan redesign, process-detector refactor, new error type, schema/API change, or documentation change.
- Do not preserve or parse partial `lsof` output from a failed command; its completeness is unverified.
