# Key default pools by local repository path

## Goal

Ensure an implicitly named Grove pool belongs to one local repository checkout. Two clones with the same directory basename and `origin` URL must resolve to different pool directories, preventing one clone from reading or mutating the other clone's lease state. Keep the fix local to pool-name resolution: use the normalized absolute `repoRoot` as the identity, preserve configured pool placement, and leave explicit `groveDir` ownership unchanged.

## Changes

1. `packages/grove/test/config.test.ts:Config` — add the regression first using real Git: create two clone directories named `repo` that share one remote, then assert `resolveGroveDir()` returns different default directories. Reuse `setupRepo()` for the origin and first checkout, clone only the second checkout inside the same temporary fixture, and avoid a broader pool lifecycle test because directory separation is the highest seam that proves the invariant.
2. `packages/grove/src/config.ts:resolveGroveDir` — remove remote URL lookup from pool identity. Normalize the documented absolute repository input with `node:path.resolve`, then derive both the readable basename and existing short hash from that local path alone. Continue resolving `groveRoot` and environment expansion exactly as today. Do not add filesystem `realpath`, repository metadata, or a new state field: those add I/O and failure modes without improving separation between distinct checkout paths.
3. Treat the resulting pool-name change as a direct cutover. Do not probe, adopt, move, or delete the old remote-keyed directory because it may already be shared by multiple clones. Existing data remains untouched; a caller that intentionally needs an old pool can address it explicitly through `groveDir`.

## Verify

- `pnpm vitest run packages/grove/test/config.test.ts`
- `pnpm check`

## Boundaries

- No pool-state schema change, migration machinery, remote identity fallback, or cross-repository redesign.
- No change to explicit `groveDir`, `groveRoot` placement semantics, or the existing pool-name shape beyond its hash input.
