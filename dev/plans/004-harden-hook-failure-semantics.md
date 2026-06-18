# Plan 004: Harden Hook Failure Semantics

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 2219718..HEAD -- packages/grove/src/hooks.ts packages/grove/src/pool.ts packages/grove/src/lease-release.ts packages/grove/src/schemas.ts packages/grove/test/lease-hooks.integration.test.ts README.md`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding. On mismatch, stop.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-tighten-error-code-contracts.md`
- **Category**: bug
- **Planned at**: commit `2219718`, 2026-06-17

## Why this matters

Hooks are lifecycle boundaries for setup and cleanup. Today `Grove.runHook()` rethrows only `HookFailedError` and swallows other unexpected failures. Release also runs `postRelease` after `finalizeRelease()`, so a caller can receive a hook error after the lease state has already been committed as released, preserved, or quarantined. The implementation should make hook failures explicit and document which hook phases are best-effort after commit.

## Current State

- `packages/grove/src/hooks.ts` executes each configured hook command through the platform shell.
- `onHookFailure` defaults to `"ignore"` in `GroveConfigSchema`.
- `Grove.runHook()` catches all errors but rethrows only `HookFailedError`.
- `completeRelease()` finalizes state before running `postRelease`.

Relevant excerpts:

```ts
// packages/grove/src/pool.ts
} catch (err: unknown) {
  if (err instanceof HookFailedError) {
    throw err;
  }
}
```

```ts
// packages/grove/src/lease-release.ts
const result = await finalizeRelease(poolDir, repoRoot, context);
await hooks.postRelease?.(context.wtPath, context.leaseEnvVars);
return result;
```

```ts
// packages/grove/src/hooks.ts
if (opts.onFailure === "fail") {
  const { HookFailedError } = await import("./errors.js");
  throw new HookFailedError(`Hook failed: ${command}`);
}
```

Repo conventions to follow:

- Hook failures with `onHookFailure: "fail"` should throw `HOOK_FAILED`.
- `preRelease` failure quarantines the lease; existing tests cover this behavior.
- `postAcquire` is documented in code as running after the lease is usable; its failures surface without quarantine.
- Keep changes surgical. Do not redesign hook configuration.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Targeted hook tests | `pnpm test -- packages/grove/test/lease-hooks.integration.test.ts` | all selected tests pass |
| Release tests | `pnpm test -- packages/grove/test/lease-release.integration.test.ts` | all selected tests pass |
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Full verification | `pnpm check` | exit 0 |

## Scope

**In scope**:

- `packages/grove/src/pool.ts`
- `packages/grove/src/hooks.ts`
- `packages/grove/src/lease-release.ts`
- `packages/grove/test/lease-hooks.integration.test.ts`
- `README.md` only for hook semantics clarification if behavior changes

**Out of scope**:

- Changing default `onHookFailure` from `"ignore"` to `"fail"` in this plan.
- Removing shell hook support.
- Adding hook allowlists or exec-file mode.

## Git Workflow

- Branch: `advisor/004-harden-hook-failure-semantics`
- Commit style: Conventional Commits, e.g. `fix: harden hook failure handling`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a focused test for unknown hook failures

Create or adapt a focused test so a hook callback throws a plain `Error` that is not `HookFailedError`. Do not spend time trying to trigger this through public shell hook strings; `runHooks()` normally converts command failures into `HookFailedError` when `onHookFailure === "fail"`. Prefer a mutator-level test around `releaseLease()` or `acquireLease()` with an injected callback that throws `new Error("boom")`, or a small unit-level test around `Grove.runHook()` behavior if that can be done without changing public APIs.

Expected behavior after the fix:

- Unknown failures are not silently swallowed when the hook phase is configured to fail.
- The thrown error is either the original error or a stable `HookFailedError`; choose the smallest behavior change and test it.

**Verify**: `pnpm test -- packages/grove/test/lease-hooks.integration.test.ts -t hook` -> targeted tests pass after implementation.

### Step 2: Fix `Grove.runHook()` swallowing

In `packages/grove/src/pool.ts`, replace the narrow catch with one of these minimal approaches:

- remove the catch entirely, letting `runHooks()` decide failure policy; or
- rethrow all errors, wrapping unknown errors in `HookFailedError` only if a stable code is needed.

Preserve current `"ignore"` semantics for hook command failures handled inside `runHooks()`.

**Verify**: `pnpm typecheck` -> exit 0.

### Step 3: Define and test `postRelease` failure semantics as the main deliverable

Decide the intended contract with the least surprising behavior:

- Preferred: `postRelease` is post-commit like `postAcquire`; failure surfaces to caller but state remains finalized. Document this explicitly and add a test that asserts state is finalized after `postRelease` failure.
- Alternative: introduce a repairable failed `postRelease` phase. Only choose this if existing transition model already supports it cleanly; current `GroveFailedPhaseSchema` does not include `postRelease`.

Do not move `postRelease` before reset/finalize unless product semantics explicitly require post-release hook to run before release is complete.

**Verify**: `pnpm test -- packages/grove/test/lease-hooks.integration.test.ts -t postRelease` -> new/updated test passes.

### Step 4: Clarify README if needed

If the chosen semantics leave `postRelease` as post-commit, add a short README note in the lifecycle hook section:

- `preRelease` failure can quarantine cleanup.
- `postRelease` runs after state is finalized; with `onHookFailure: "fail"`, the operation may throw even though release state was committed.

**Verify**: `pnpm lint` -> exit 0.

## Test Plan

- Existing hook failure tests remain passing.
- New regression for unknown hook failure not being swallowed, preferably at mutator/unit level.
- New or strengthened `postRelease` test asserting both thrown error and final state behavior. This is the primary behavior contract for the plan.

## Done Criteria

- [ ] `pnpm test -- packages/grove/test/lease-hooks.integration.test.ts` exits 0.
- [ ] `pnpm test -- packages/grove/test/lease-release.integration.test.ts` exits 0.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm check` exits 0.
- [ ] Hook semantics are documented if visible behavior is clarified.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report if:

- Fixing `postRelease` requires adding a new persisted state phase.
- Existing tests show callers rely on swallowed non-hook errors.
- The desired behavior conflicts with README lifecycle hook docs.
- Verification fails twice after reasonable fixes.

## Maintenance Notes

Reviewers should scrutinize whether hook behavior is consistent across acquire, release, repair, and destroy. Future hook phases should state whether they are pre-commit repairable hooks or post-commit notification hooks.
