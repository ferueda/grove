# Plan 006: Route Pool Healing Through Transitions

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 2219718..HEAD -- packages/grove/src/pool-state.ts packages/grove/src/transitions.ts packages/grove/test/transitions.test.ts packages/grove/test/mutator-enforcement.test.ts packages/grove/test/state-v1.test.ts packages/grove/test/state.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding. On mismatch, stop.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-tighten-error-code-contracts.md`
- **Category**: tech-debt
- **Planned at**: commit `2219718`, 2026-06-17

## Why this matters

The repo’s contributor rules say lease/slot mutations should route through `packages/grove/src/transitions.ts`. `pool-state.ts` currently heals `destroying` slots back to `available` by direct assignment. That bypasses transition rules and can hide joint lease/slot invariant problems during read-time healing.

## Current State

- `healPoolState()` runs by default in `loadPoolState()`.
- `findOrAllocateSlot()` can also reclaim a `destroying` slot by direct assignment.
- `mutator-enforcement.test.ts` enforces mutation rules only for `lease-*.ts`, not `pool-state.ts`.

Relevant excerpts:

```ts
// packages/grove/src/pool-state.ts
if (slot.state === "destroying" && !(await ownerAlive(slotOwnerEntry(slot)))) {
  const lease = leaseForSlot(state, slot.slotName);
  if (!lease || lease.state !== "destroying") {
    slot.state = "available";
    await clearSlotOwner(slot);
  }
}
```

```ts
// packages/grove/src/pool-state.ts
if (slot.state === "destroying") {
  if (await slotIsIdle(slot)) {
    slot.state = "available";
    await clearSlotOwner(slot);
  } else {
    continue;
  }
}
```

Repo conventions to follow:

- State-machine changes belong in `packages/grove/src/transitions.ts`.
- Transition behavior is tested in `packages/grove/test/transitions.test.ts`.
- If a core pool logic change is made, run Vitest immediately.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Transition tests | `pnpm test -- packages/grove/test/transitions.test.ts` | all transition tests pass |
| State tests | `pnpm test -- packages/grove/test/state-v1.test.ts packages/grove/test/state.test.ts` | all selected tests pass |
| Mutator guard | `pnpm test -- packages/grove/test/mutator-enforcement.test.ts` | guard passes |
| Full verification | `pnpm check` | exit 0 |

## Scope

**In scope**:

- `packages/grove/src/transitions.ts`
- `packages/grove/src/pool-state.ts`
- `packages/grove/test/transitions.test.ts`
- `packages/grove/test/mutator-enforcement.test.ts`
- `packages/grove/test/state-v1.test.ts` or `packages/grove/test/state.test.ts` for healing behavior

**Out of scope**:

- Replacing the full persistence stack.
- Removing legacy state migration.
- Changing public lease states.

## Git Workflow

- Branch: `advisor/006-route-pool-healing-through-transitions`
- Commit style: Conventional Commits, e.g. `refactor: route pool healing through transitions`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Characterize current healing cases

Add focused tests for these current behaviors:

- A `destroying` slot with no matching destroying lease and dead owner becomes `available`.
- A `destroying` slot with an active destroying lease stays `destroying`.
- A destroying slot that is still in use is not reclaimed by `findOrAllocateSlot()`.

Use existing state fixtures and avoid mocking git in integration paths. If unit-level owner liveness is hard to control, use existing test patterns that set owner PID to a known-dead sentinel.

**Verify**: `pnpm test -- packages/grove/test/state-v1.test.ts packages/grove/test/transitions.test.ts` -> characterization tests pass before refactor.

### Step 2: Add explicit transition events

In `packages/grove/src/transitions.ts`, add a small slot transition event for reclaiming abandoned destroying slots, for example `RECLAIM_DESTROYING_SLOT`. It should:

- accept only `slot.state === "destroying"`
- return a slot with `state: "available"`
- update `updatedAt`
- preserve path/slot identity

Add transition tests for allowed and disallowed states.

**Verify**: `pnpm test -- packages/grove/test/transitions.test.ts` -> transition tests pass.

### Step 3: Replace direct state assignment in `pool-state.ts`

Use the new `transitionSlot()` event in both `healPoolState()` and `findOrAllocateSlot()`. Keep owner clearing explicit if transition helpers do not own process-reservation fields.

Do not introduce direct `.state =` mutation elsewhere.

**Verify**: `pnpm test -- packages/grove/test/state-v1.test.ts packages/grove/test/mutator-enforcement.test.ts` -> selected tests pass.

### Step 4: Extend mutator enforcement

Update `packages/grove/test/mutator-enforcement.test.ts` so it also checks `packages/grove/src/pool-state.ts` for direct `.state =` mutations, while allowing fixture/test files.

**Verify**: `pnpm test -- packages/grove/test/mutator-enforcement.test.ts` -> guard passes.

## Test Plan

- New transition tests for reclaiming abandoned destroying slots.
- New or strengthened state healing tests.
- Mutator enforcement expanded to cover `pool-state.ts`.

## Done Criteria

- [ ] No direct `slot.state =` assignments remain in `packages/grove/src/pool-state.ts`.
- [ ] `pnpm test -- packages/grove/test/transitions.test.ts` exits 0.
- [ ] `pnpm test -- packages/grove/test/state-v1.test.ts packages/grove/test/mutator-enforcement.test.ts` exits 0.
- [ ] `pnpm check` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report if:

- The transition model cannot express reclaiming a destroying slot without weakening invariants.
- Existing tests show healing intentionally bypasses transitions for migration compatibility.
- The change requires altering public persisted state shape.
- Verification fails twice after reasonable fixes.

## Maintenance Notes

Read-time healing is easy to under-test because it happens implicitly on load. Reviewers should check both transition tests and state tests whenever healing logic changes.
