# Plan 008: Restrict Grove State File Permissions

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 2219718..HEAD -- packages/grove/src/state-v1.ts packages/grove/src/state.ts packages/grove/test/state-v1.test.ts packages/grove/test/state.test.ts README.md`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding. On mismatch, stop.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `2219718`, 2026-06-17

## Why this matters

`grove-state.json` can contain local worktree paths, branch names, owner IDs, and user-provided metadata. The state file is currently written with mode `0644`, which is readable by other local users on shared hosts. Grove should prefer least-privilege permissions for state under `~/.grove` or a configured Grove directory.

## Current State

- `packages/grove/src/state-v1.ts` writes lease-first state through a temporary file and rename.
- `packages/grove/src/state.ts` has legacy state writing with the same `0644` mode.
- State schemas do not include secrets by design, but metadata can still be sensitive operational data.

Relevant excerpt:

```ts
// packages/grove/src/state-v1.ts
const data = JSON.stringify(parsed.data, null, 2);
const target = stateFilePath(groveDir);
const tmp = `${target}.tmp`;
await writeFile(tmp, data, { mode: 0o644 });
await rename(tmp, target);
```

Repo conventions to follow:

- Use Node filesystem APIs directly; this repo targets Node >=24.
- Keep legacy and lease-first persistence behavior aligned when the change is safe.
- Do not introduce config files.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| State tests | `pnpm test -- packages/grove/test/state-v1.test.ts packages/grove/test/state.test.ts` | selected tests pass |
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Full verification | `pnpm check` | exit 0 |

## Scope

**In scope**:

- `packages/grove/src/state-v1.ts`
- `packages/grove/src/state.ts`
- `packages/grove/test/state-v1.test.ts`
- `packages/grove/test/state.test.ts`
- `README.md` only if adding a short permissions note is useful

**Out of scope**:

- Encrypting state.
- Redacting metadata.
- Changing state schema.
- Changing pool directory layout.

## Git Workflow

- Branch: `advisor/008-restrict-state-file-permissions`
- Commit style: Conventional Commits, e.g. `fix: restrict grove state file permissions`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a permission regression test

In `packages/grove/test/state-v1.test.ts`, write lease-first state to a temp Grove dir using the public state helper. Stat `grove-state.json` and assert group/other permission bits are not set on POSIX:

```ts
expect(stat.mode & 0o077).toBe(0);
```

If exact mode is stable on the local platform, `expect(stat.mode & 0o777).toBe(0o600)` is also acceptable, but the group/other-bit assertion is the safer CI contract because it focuses on the security property.

If Windows mode bits are not reliable in Vitest on Node, skip only the mode assertion on `process.platform === "win32"` with a clear test comment.

Repeat for legacy `state.ts` only if that writer remains exercised by tests and the assertion is stable.

**Verify**: `pnpm test -- packages/grove/test/state-v1.test.ts packages/grove/test/state.test.ts -t permission` -> new test fails before implementation or passes after implementation.

### Step 2: Change state writes to `0600`

In `writeLeaseFirstState()`, change temporary file mode from `0o644` to `0o600`.

In the legacy writer in `packages/grove/src/state.ts`, make the same change if it still writes a temp state file. Keep both persistence stacks aligned unless a legacy test proves compatibility issue.

This plan does not need a one-time migration for existing `0644` state files. Existing pools will be corrected on the next successful state write. If a README note is added, state that clearly.

**Verify**: `pnpm test -- packages/grove/test/state-v1.test.ts packages/grove/test/state.test.ts` -> selected tests pass.

### Step 3: Consider pool directory mode only if already centralized

If there is one clear directory creation helper for `groveDir`, consider ensuring it creates directories with owner-only permissions. Do not chase every `mkdir` call in this plan. If directory permissions are scattered, defer to a separate plan.

**Verify**: `pnpm typecheck` -> exit 0.

## Test Plan

- New state permission regression for lease-first state.
- Optional legacy state permission regression if stable.
- Existing state migration tests remain passing.

## Done Criteria

- [ ] Lease-first state file writes with no group/other permission bits on POSIX.
- [ ] Legacy state writer is aligned or an explicit comment explains why not.
- [ ] `pnpm test -- packages/grove/test/state-v1.test.ts packages/grove/test/state.test.ts` exits 0.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm check` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report if:

- Existing tests or docs require group/world-readable state.
- Node/OS behavior makes permission assertions flaky even with platform guards and the `(mode & 0o077) === 0` form.
- The fix requires changing pool directory ownership or layout.
- Verification fails twice after reasonable fixes.

## Maintenance Notes

This change reduces local information exposure but does not make metadata safe for secrets. Reviewers should continue to reject storing credentials in `metadata` or hook configuration.
