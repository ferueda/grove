# Constrain destroy to its owned slot directory

## Goal

Prevent `destroy()` from recursively deleting the pool root or unrelated pool contents when
persisted, schema-valid state gives a slot a shallow or malformed path. Before either Git or
filesystem removal, the directory passed to recursive `rm` must be a non-pool direct child of
`poolDir` whose basename equals the persisted `slotName`. Keep the existing
`PATH_OUTSIDE_POOL` error contract and transition-driven failure quarantine. Canonical
`poolDir/<slotName>/<repo>` worktrees must continue to destroy normally.

## Changes

1. `packages/grove/test/lease-destroy.integration.test.ts` — add the failing regression first,
   through the public SDK/state seams and real Git:
   - Acquire a normal lease, then use `git worktree move` to relocate its registered worktree to
     the schema-valid shallow path `poolDir/<repo>`.
   - Read the acquired state with `readLeaseFirstState`, update the matching slot and lease paths,
     and persist it with `writeLeaseFirstState`. This proves the fixture passes the existing schema
     and joint-invariant boundary instead of bypassing validation with raw JSON.
   - Place an unrelated sentinel file in `poolDir`, call `grove.destroy(leaseId, { force: true })`,
     and assert `PATH_OUTSIDE_POOL`, an intact sentinel, an intact shallow worktree, and a
     quarantined lease. These assertions prove rejection happens before both `removeWorktree` and
     recursive `rm`, while preserving destroy failure transitions.
   - Keep the existing `idempotent destroy resumes an in-progress destroying lease` case green as
     positive coverage for canonical slot layout, worktree removal, and state finalization; do not
     add a duplicate happy-path fixture.

2. `packages/grove/src/lease-destroy.ts:completeDestroy` — add one private, destroy-specific helper
   that derives `slotDir = dirname(wtPath)` and returns it only when all three conditions hold:
   `slotDir !== normalize(poolDir)`, `dirname(slotDir) === normalize(poolDir)`, and
   `basename(slotDir) === slot.slotName`. Otherwise throw `PathOutsidePoolError` with a concise
   slot-layout message. Run the existing `assertPathWithinPool(poolDir, wtPath)` first, then this
   helper, before `removeWorktree`; pass the returned directory to `rm` instead of recomputing
   `dirname(wtPath)`. The current `completeDestroy` catch must remain the owner of quarantine and
   rethrow behavior.

## Verify

- `pnpm exec vitest run packages/grove/test/lease-destroy.integration.test.ts`
- `pnpm check`

## Boundaries

- No persisted-state schema tightening or migration: malformed historical state must remain
  readable and recover as a quarantined destroy failure.
- No generalized filesystem/path framework, repo-basename validation, or changes to release;
  only destroy recursively removes the slot parent.
