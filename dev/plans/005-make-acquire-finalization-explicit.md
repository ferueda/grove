# Plan 005: Make Acquire Finalization Fail Explicitly

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 2219718..HEAD -- packages/grove/src/lease-acquire.ts packages/grove/src/errors.ts packages/grove/src/transitions.ts packages/grove/test/lease-acquire.integration.test.ts packages/grove/test/lease-repair.integration.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding. On mismatch, stop.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/001-tighten-error-code-contracts.md`
- **Category**: bug
- **Planned at**: commit `2219718`, 2026-06-17

## Why this matters

`finalizeLeaseCheckout()` is the point where a prepared lease becomes leased after git checkout succeeds. If the lease or slot is missing, or if the transition is invalid, the function currently returns from inside the lock without raising the real problem. That can leave a checkout on disk while callers later see only a generic "missing after acquire complete" error.

## Current State

- `packages/grove/src/lease-acquire.ts` runs git checkout, then calls `finalizeLeaseCheckout()`.
- Inside `finalizeLeaseCheckout()`, missing lease/slot and null transition both silently return.
- `quarantineFailedAcquire()` has a related silent return when the lease or slot is missing during failure handling.
- The function later reloads state and throws a generic `Error` only if the lease is missing.

Relevant excerpt:

```ts
// packages/grove/src/lease-acquire.ts
const lease = findLease(state, leaseId);
const slot = lease ? findSlot(state, lease.slotName) : undefined;
if (!lease || !slot) return;

const nextLease = transitionLease(lease, {
  type: "ACQUIRE_COMPLETE",
  target: finalizedTarget,
  headSha,
});
if (!nextLease) return;
```

```ts
// packages/grove/src/lease-acquire.ts
const lease = findLease(state, leaseId);
const slot = lease ? findSlot(state, lease.slotName) : undefined;
if (!lease || !slot) return;
```

Repo conventions to follow:

- Throw explicit Grove errors from `packages/grove/src/errors.ts`.
- State transitions go through `packages/grove/src/transitions.ts`.
- Acquire behavior is covered in `packages/grove/test/lease-acquire.integration.test.ts`.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Targeted acquire tests | `pnpm test -- packages/grove/test/lease-acquire.integration.test.ts` | all selected tests pass |
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Full verification | `pnpm check` | exit 0 |

## Scope

**In scope**:

- `packages/grove/src/lease-acquire.ts`
- `packages/grove/test/lease-acquire.integration.test.ts`
- `packages/grove/src/errors.ts` only if a more specific existing error cannot express the condition

**Out of scope**:

- Refactoring acquire/resume-acquire orchestration.
- Changing branch/ref compatibility semantics.
- Changing persisted state shape.

## Git Workflow

- Branch: `advisor/005-make-acquire-finalization-explicit`
- Commit style: Conventional Commits, e.g. `fix: fail explicitly during acquire finalization`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a focused regression test

Write the smallest test that exercises `finalizeLeaseCheckout()` directly or through acquire with a controlled state mutation.

Preferred focused unit/integration shape:

- Set up a repo with `setupRepo()`.
- Create a preparing lease state or use an existing acquire helper.
- Remove the lease or slot before calling `finalizeLeaseCheckout()`.
- Assert rejection with a stable Grove error, likely `LEASE_NOT_FOUND` for missing lease/slot.

If calling `finalizeLeaseCheckout()` directly requires too much private setup, create a test around a helper-level path and keep it in `lease-acquire.integration.test.ts`.

**Verify**: `pnpm test -- packages/grove/test/lease-acquire.integration.test.ts -t finalize` -> new test fails before implementation or passes after implementation.

### Step 2: Replace silent returns with explicit errors

In `finalizeLeaseCheckout()`:

- If lease is missing, throw `LeaseNotFoundError`.
- If slot is missing, throw `LeaseNotFoundError` with a slot-specific message.
- If `transitionLease()` returns null, throw an existing explicit transition error if available. If no suitable error exists, use the repo’s existing invalid-transition error class rather than a generic `Error`.

Do not swallow these errors in `acquireLease()`; its existing catch should quarantine failed acquire and rethrow.

**Verify**: `pnpm typecheck` -> exit 0.

### Step 3: Assert quarantine behavior if applicable

If the explicit finalization error is caught by acquire and causes `quarantineFailedAcquire()`, assert the lease moves to quarantined state with a useful failed phase. If no lease exists to quarantine, assert the explicit error surfaces.

**Verify**: `pnpm test -- packages/grove/test/lease-acquire.integration.test.ts` -> all acquire tests pass.

### Step 4: Audit `quarantineFailedAcquire()` silent returns without masking original errors

Review `quarantineFailedAcquire()` for the same silent-failure class. Because this function runs while handling an earlier checkout or hook failure, do not blindly throw from it if doing so would mask the original error that caused acquire to fail.

Preferred behavior:

- If lease and slot exist, quarantine as today.
- If lease or slot is missing during failure cleanup, preserve the original thrown error from the checkout/hook path and attach/log enough context only if the repo has an existing pattern for that.
- If a deterministic test can cover this path without racing, add it. If not, add a short maintenance note in code or tests explaining why finalization is explicit but cleanup remains best-effort.

**Verify**: `pnpm test -- packages/grove/test/lease-acquire.integration.test.ts` -> all acquire tests pass and original acquire errors are not masked.

## Test Plan

- New regression around missing lease/slot or invalid transition during finalization.
- Audit coverage or explicit rationale for `quarantineFailedAcquire()` missing lease/slot behavior.
- Existing acquire happy-path, conflict, branch missing, and repair tests still pass.

## Done Criteria

- [ ] No `return` remains for missing lease/slot or null transition in `finalizeLeaseCheckout()`.
- [ ] `quarantineFailedAcquire()` missing lease/slot behavior is either tested or explicitly documented as best-effort cleanup that must not mask the original failure.
- [ ] Generic `Error` is not used for expected finalization state failures.
- [ ] `pnpm test -- packages/grove/test/lease-acquire.integration.test.ts` exits 0.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm check` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report if:

- No existing Grove error can represent an invalid acquire transition cleanly.
- The regression requires racing concurrent processes rather than deterministic state setup.
- Making `quarantineFailedAcquire()` throw would mask the original checkout or hook failure.
- The fix changes public acquire success behavior.
- Verification fails twice after reasonable fixes.

## Maintenance Notes

Acquire finalization is crash-recovery-sensitive. Reviewers should check that explicit errors still drive the existing quarantine path when a preparing lease can be found.
