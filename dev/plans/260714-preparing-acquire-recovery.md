# Recover Crash-Stuck Preparing Acquires

## Goal

Make the documented `repair({ action: "resume-acquire" })` path recover a lease
persisted in `preparing`, not only one quarantined after a caught failure. Preserve
the original checkout intent and existing branch-reuse behavior while adding the
minimum durable information needed to decide whether `postCreate` is still due.
Baseline: `38df31ba10bd06d1c48fe5cd20f0023743225840`.

Acceptance semantics:

- A `preparing` or `quarantined` lease with `pendingAcquire` can resume; other
  states or missing intent still return `REPAIR_NOT_AVAILABLE`.
- Every new acquire explicitly persists `pendingAcquire.postCreatePending`:
  `true` for a newly allocated physical slot, `false` for a reused slot.
- The marker stays `true` through materialization and hook execution, then is
  durably set to `false` before checkout. A crash during the hook, or after its
  side effects but before that state write, therefore retries `postCreate`.
  This is intentionally at-least-once, not exactly-once.
- A present worktree with an explicit `false` marker never runs `postCreate`.
  A missing worktree overrides the marker to `true`, because repair must create
  a new physical worktree before continuing.
- Older persisted intents without the additive marker remain valid. On repair,
  missing path or `diagnostics.failedPhase === "postCreate"` means pending;
  otherwise an existing path means complete/not-required. This conservative
  fallback avoids running `postCreate` on a legacy reused slot; an old,
  ambiguous new-slot crash with an existing path cannot be distinguished and
  also skips the hook.

## Changes

1. `packages/grove/src/schemas.ts:PendingAcquireSchema` and
   `packages/grove/src/target.ts:buildPendingAcquire` — add optional boolean
   `postCreatePending`. Keep it optional solely for persisted-state and exported
   type compatibility; do not apply a Zod default because repair must distinguish
   an old missing value from an explicit `false`. Require all newly built intents
   to supply the boolean.

2. `packages/grove/src/transitions.ts:LeaseEvent` and `transitionLease` — keep
   lease mutations transition-owned. Allow `REPAIR_RESUME_ACQUIRE` from either
   `quarantined` or `preparing`; retain its `pendingAcquire` guard and accept an
   optional `postCreatePending` payload so existing external event construction
   remains source-compatible while repair can normalize legacy intent. Add one
   `ACQUIRE_POST_CREATE_COMPLETE` event that is valid only for a `preparing`
   lease with pending post-create work and replaces the nested marker with
   `false`. Do not change slot transitions: quarantined recovery still uses
   `REPAIR_RESUME_LEASE`; an already-preparing lease already owns a leased slot.

3. `packages/grove/src/lease-acquire.ts:acquireLease` — build `pendingAcquire`
   after `findOrAllocateSlot()` reveals `isNew`, and persist the explicit marker
   in the same write-ahead state save as the preparing lease. After a new slot's
   `postCreate` step succeeds (including the no-hook case), persist
   `ACQUIRE_POST_CREATE_COMPLETE` under the state lock before checkout. Leave
   the marker true when materialization or `postCreate` fails so existing
   quarantine-and-repair behavior retries the unfinished step; checkout failures
   occur after the marker is false and must not rerun it.

4. `packages/grove/src/lease-acquire.ts:resumeAcquireLease` — mirror
   `resumeCleanupLease` state handling: transition quarantined records back to
   preparing, accept preparing records directly, reject all others. While
   holding the initial lock, derive and persist the repair marker in this exact
   order: missing worktree => `true`; otherwise explicit marker => use it;
   otherwise legacy `failedPhase: "postCreate"` => `true`; otherwise `false`.
   Persist that decision through `REPAIR_RESUME_ACQUIRE` before materialization
   or hooks, run/complete `postCreate` only when true, then use the existing
   checkout/finalization flow. Keep `targetToAcquireOptions()` recovery semantics:
   a pending create-from branch uses `ifExists: "reuse"`, allowing a branch
   created before the crash to finish acquisition without weakening normal
   acquire's fail-first policy.

5. Test first with real Git fixtures:

   - `packages/grove/test/lease-repair.integration.test.ts` — seed valid
     write-ahead crash snapshots and prove public `repair()` directly completes
     a `preparing` lease; retries `postCreate` when the persisted marker is true;
     and, for an actually reused physical slot with a false marker, skips a
     failing `postCreate` hook while reusing a branch created before the crash.
     Assert final leased target/head data and cleared `pendingAcquire`.
   - `packages/grove/test/lease-hooks.integration.test.ts` — strengthen the
     existing failed-`postCreate` case to assert the pending marker remains true
     through quarantine and the existing repair retry still succeeds.
   - `packages/grove/test/transitions.test.ts` — cover quarantined-to-preparing
     and preparing-to-preparing repair, marker normalization, post-create
     completion, missing intent, and invalid completion states.
   - `packages/grove/test/state-v1.test.ts` — prove a pre-change preparing record
     without `postCreatePending` still parses. No legacy worktree-shape migration
     or state version is needed.

6. `README.md:Lease states` and `README.md:Lifecycle hooks` — retain the existing
   preparing repair instruction, now backed by behavior. Clarify that crash
   recovery may retry `postCreate`, so commands requiring recovery safety must be
   idempotent; reused physical slots do not run it.

## Verify

- `pnpm exec vitest run packages/grove/test/lease-repair.integration.test.ts packages/grove/test/lease-hooks.integration.test.ts packages/grove/test/transitions.test.ts packages/grove/test/state-v1.test.ts`
- `pnpm check`

## Boundaries

- No broader acquire phase enum or new state machine; one pending boolean is
  sufficient for the only ambiguous side effect.
- No exactly-once hook guarantee, subprocess recovery, active-owner/liveness
  policy, `postAcquire` replay, ref-pinning change, branch-ownership fix, CLI
  change, or state-file version bump.
- No timestamp/path-layout inference for ambiguous legacy records.
