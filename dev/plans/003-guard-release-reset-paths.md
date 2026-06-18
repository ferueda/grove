# Plan 003: Guard Release Reset Paths Inside the Pool

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 2219718..HEAD -- packages/grove/src/lease-release.ts packages/grove/src/path-boundary.ts packages/grove/src/schemas.ts packages/grove/test/lease-release.integration.test.ts packages/grove/test/lease-destroy.integration.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding. On mismatch, stop.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/001-tighten-error-code-contracts.md`
- **Category**: security
- **Planned at**: commit `2219718`, 2026-06-17

## Why this matters

Destroy already checks that the worktree path is inside the Grove pool before removing it. Release with `cleanup: "reset"` performs destructive git operations (`reset --hard` and `clean`) on `context.wtPath` without the same boundary guard. If `grove-state.json` is corrupted or tampered with, Grove should fail closed before destructive cleanup touches a path outside the managed pool.

## Current State

- `packages/grove/src/path-boundary.ts` contains `assertPathWithinPool()`.
- `packages/grove/src/lease-destroy.ts` calls `assertPathWithinPool(poolDir, wtPath)` before removing a worktree.
- `packages/grove/src/lease-release.ts` calls `resetWorktree(context.wtPath, ...)` with no pool-boundary assertion.
- `GroveSlotSchema.path` and `GroveLeaseSchema.path` are unconstrained strings.

Relevant excerpts:

```ts
// packages/grove/src/lease-release.ts
await resetWorktree(
  context.wtPath,
  context.pendingCleanup.resetTo,
  context.pendingCleanup.cleanIgnored === undefined
    ? undefined
    : { cleanIgnored: context.pendingCleanup.cleanIgnored },
);
```

```ts
// packages/grove/src/lease-destroy.ts
await assertPathWithinPool(poolDir, wtPath);
await removeWorktree(config.repoRoot, wtPath);
await rm(dirname(wtPath), { recursive: true, force: true });
```

Repo conventions to follow:

- Throw explicit Grove error subclasses from `packages/grove/src/errors.ts`.
- Keep destructive operations path-safe.
- Use integration tests with real git and `setupRepo()`.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Targeted release tests | `pnpm test -- packages/grove/test/lease-release.integration.test.ts` | all selected tests pass |
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Lint | `pnpm lint` | exit 0 |
| Full verification | `pnpm check` | exit 0 |

## Scope

**In scope**:

- `packages/grove/src/lease-release.ts`
- `packages/grove/test/lease-release.integration.test.ts`
- `packages/grove/src/path-boundary.ts` only if its helper needs a tiny reuse-friendly adjustment
- `packages/grove/src/schemas.ts` only if adding read-time validation is chosen and stays small

**Out of scope**:

- Reworking all state schemas.
- Changing destroy behavior.
- Adding a config-file loader or user-facing cleanup policy.

## Git Workflow

- Branch: `advisor/003-guard-release-reset-paths`
- Commit style: Conventional Commits, e.g. `fix: guard release reset paths`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a regression test that corrupts release reset path

In `packages/grove/test/lease-release.integration.test.ts`, create a leased worktree via existing helpers. Then mutate the state file or state object using existing state helpers so the slot path for that lease points outside `groveDir`, preferably to a temp directory created by the test.

Call:

```ts
await grove.release(lease.leaseId, {
  cleanup: "reset",
  resetTo: "main",
  force: true,
});
```

Assert rejection with `{ code: "PATH_OUTSIDE_POOL" }`. Also assert the outside directory still exists.

**Verify**: `pnpm test -- packages/grove/test/lease-release.integration.test.ts -t "outside"` -> new test fails before implementation or passes after implementation.

### Step 2: Guard reset before destructive git calls

Import `assertPathWithinPool` into `packages/grove/src/lease-release.ts`. In `completeRelease()`, after the fresh process-safety check and before `resetWorktree()`, call:

```ts
await assertPathWithinPool(poolDir, context.wtPath);
```

Do not catch and wrap `PATH_OUTSIDE_POOL` as `UNSAFE_CLEANUP`; it should surface as its own stable code.

**Verify**: `pnpm test -- packages/grove/test/lease-release.integration.test.ts -t "outside"` -> new test passes.

### Step 3: Consider read-time invariant only if the test setup exposes a broader gap

If writing the regression requires invalid state to pass schema validation, keep the narrow release guard as the main fix. Add read-time path validation only if it can be done without breaking legitimate legacy migration states.

If read-time validation is added, make it a helper that validates all slot/lease paths are under `poolDir` after migration, and test it separately.

**Verify**: `pnpm typecheck` -> exit 0.

## Test Plan

- New release integration test for reset refusing an out-of-pool path.
- Existing destroy boundary test remains passing.
- Error assertion should use `{ code: "PATH_OUTSIDE_POOL" }`.

## Done Criteria

- [ ] `pnpm test -- packages/grove/test/lease-release.integration.test.ts` exits 0.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm lint` exits 0.
- [ ] `pnpm check` exits 0.
- [ ] No destructive reset can occur before `assertPathWithinPool()` passes.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report if:

- The existing path-boundary helper cannot safely validate release reset paths.
- The fix requires changing persisted state format.
- The regression test can only be written by depending on private implementation details that are unstable.
- Verification fails twice after reasonable fixes.

## Maintenance Notes

Any future destructive operation using a persisted path must call the same boundary helper immediately before touching disk or invoking git cleanup. Reviewers should search for `resetWorktree`, `removeWorktree`, `rm(`, and `git clean` callers when reviewing similar changes.
