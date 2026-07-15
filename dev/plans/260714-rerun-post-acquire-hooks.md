# Rerun and serialize post-acquire hooks on compatible reacquire

## Goal

Fix issue #95 so every compatible `acquire()` that returns an existing lease runs that caller's configured `postAcquire` commands before resolving. Preserve post-commit failure semantics: a failed hook rejects the call while the lease remains `leased`, allowing a later compatible acquire to retry with the same lease ID, path, checkout, and slot. Serialize `postAcquire` executions for the active lease's worktree without holding the global state lock. Callers remain responsible for constructing each `Grove` instance with consistent programmatic hook configuration.

## Changes

1. `packages/grove/test/lease-hooks.integration.test.ts` — add real-Git regression coverage first. Prove a fail-once hook leaves the lease committed, explicit and implicit compatible reacquires produce attempts `1 -> 2 -> 3` with the same lease/path and one slot, `postCreate` is not repeated, and the existing HEAD plus dirty worktree content remain untouched. Prove incompatible and `ifLeased: "fail"` calls do not invoke `postAcquire`.
2. `packages/grove/test/state.test.ts` — prove same-worktree lease-hook callbacks serialize with controlled promise barriers, independently of state-lock retry timing.
3. `packages/grove/src/lock.ts:withStateLock` — share the existing retry/release/error behavior through a small internal lock runner and add a worktree-scoped lease-hook lock. Lock the existing worktree directory with `proper-lockfile`, yielding a dedicated canonical cross-process lock that is automatically removed on release and does not create persisted lease configuration or state.
4. `packages/grove/src/lease-acquire.ts:acquireLease` — capture a copy of the compatible leased record while holding the state lock, then enrich it and invoke `postAcquire` after releasing that lock. Route fresh acquire, compatible reacquire, and `resumeAcquireLease` through one hook helper using the worktree-scoped lock. Hook or lock failure must propagate without quarantining or changing the already committed `leased` state; no compatible path may rerun checkout, `postCreate`, branch mutation, or slot allocation.
5. `README.md:Lifecycle hooks` — define `postAcquire` as per-call behavior for fresh and compatible reacquires, require idempotent commands, explain same-worktree serialization, and state that every process must recreate Grove with consistent programmatic hooks. Clarify that acquire's idempotency covers lease allocation and checkout, not suppression of lifecycle-hook side effects.

## Verify

- `pnpm exec vitest run packages/grove/test/lease-hooks.integration.test.ts packages/grove/test/lease-acquire.integration.test.ts`
- `pnpm check`

## Boundaries

- Do not persist hook commands, fingerprints, or completion state.
- Do not hold `grove-state.lock` while executing hooks.
- Do not change conflict, `ifLeased: "fail"`, `postCreate`, release, destroy, or repair state-machine contracts.
