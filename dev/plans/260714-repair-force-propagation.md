# Preserve repair force intent through destroy

## Goal

Make `repair({ action: "force-destroy" })` honor the caller's optional `force` value for the entire destroy operation. A process that appears during `preDestroy` must make the fresh pre-removal scan fail with `UNSAFE_CLEANUP` when force was omitted or false; explicit `force: true` must remain the only override. Preserve the current destroy/quarantine lifecycle, API, and error contracts with the smallest data-flow correction.

## Changes

1. `packages/grove/test/lease-repair.integration.test.ts` — test first by expanding the existing force-destroy integration case into the regression and positive path. Acquire a real worktree, release it with `cleanup: "quarantine"` through the SDK so its owner reservation is cleared, then call exported `repairLease` without force and inject a `preDestroy` callback that starts a long-running Node child with the worktree as its CWD. Wait for the child to become visible using the established process-test timing pattern, assert the fresh scan rejects with `UNSAFE_CLEANUP`, the worktree still exists, and the failed destroy leaves the lease quarantined. Keep that hook-created child alive, retry through public `grove.repair` with `force: true`, and retain the existing destroyed result, missing lease, and removed-path assertions. Always kill and await the child in `finally` so failures cannot leak a process or race fixture cleanup. This single real-git case proves both sides of the contract without state-file mutation or mocked Git.
2. `packages/grove/src/lease-repair.ts:repairForceDestroy` — pass the existing `options` object directly to `destroyLease` instead of replacing it with `{ force: true }`, and remove the now-unused `DestroyLeaseOptions` type import. Keep the repair preflight, `destroyLease`'s begin scan, its post-hook fresh scan, hook wiring, and failure quarantine unchanged; `destroyLease` will carry the same caller value in `DestroyContext.force` to the final safety check.

## Verify

- `pnpm vitest run packages/grove/test/lease-repair.integration.test.ts`
- `pnpm check`

## Boundaries

- No changes to destroy/process-safety algorithms, transitions, schemas, public types, CLI behavior, docs, or error classes.
- Do not rename `force-destroy`, remove existing safety scans, or add a second force option; this fix only stops repair from manufacturing force authorization.
