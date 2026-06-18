# Plan 001: Tighten Stable Error Code Contracts

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 2219718..HEAD -- packages/grove/test packages/grove-cli/test packages/grove-cli/src/exit-codes.ts packages/grove/src/errors.ts packages/grove/src/git/branch.ts README.md`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding. On mismatch, stop.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `2219718`, 2026-06-17

## Why this matters

Grove documents stable error codes as part of both SDK and CLI contracts. Several existing tests assert only error message text, while the CLI maps codes to process exit categories. Message-only assertions let a future refactor break automation that keys on `.code` without failing tests.

## Current state

- `packages/grove/src/errors.ts` defines the public `GroveErrorCode` union and subclasses.
- `packages/grove-cli/src/exit-codes.ts` maps `GroveErrorCode` values to CLI exit codes.
- `packages/grove/test/lease-*.integration.test.ts` has several message-only assertions.
- `packages/grove/src/git/branch.ts` throws `RefNotFoundError`, but no test currently asserts `REF_NOT_FOUND`.

Relevant excerpts:

```ts
// packages/grove-cli/src/exit-codes.ts
const EXIT_CODES: Partial<Record<GroveErrorCode, number>> = {
  INVALID_INPUT: 2,
  LEASE_CONFLICT: 3,
  // ...
  REF_NOT_FOUND: 13,
  HOOK_FAILED: 14,
};
```

```ts
// packages/grove/test/lease-acquire.integration.test.ts
await expect(
  grove.acquire({ leaseId: "conflict", mode: "branch", branch: "other" }),
).rejects.toThrow("Lease conflict");
```

Repo conventions to follow:

- Behavior tests for lease flows live under `packages/grove/test/lease-*.integration.test.ts`.
- CLI contract tests live under `packages/grove-cli/test/cli.test.ts`.
- Use real git in integration tests via `setupRepo()`. Do not mock git in pool/integration tests.
- Error classes must come from `packages/grove/src/errors.ts` and keep stable `.code` values.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Targeted SDK tests | `pnpm test -- packages/grove/test/lease-acquire.integration.test.ts packages/grove/test/lease-release.integration.test.ts packages/grove/test/lease-destroy.integration.test.ts` | all selected tests pass |
| Targeted CLI tests | `pnpm build && pnpm test -- packages/grove-cli/test/cli.test.ts` | build succeeds and selected tests pass |
| Full verification | `pnpm check` | exit 0 |

## Scope

**In scope**:

- `packages/grove/test/lease-acquire.integration.test.ts`
- `packages/grove/test/lease-release.integration.test.ts`
- `packages/grove/test/lease-destroy.integration.test.ts`
- `packages/grove/test/git.test.ts` if needed for `GIT_NOT_FOUND`
- `packages/grove-cli/test/cli.test.ts`
- Optional new unit test: `packages/grove-cli/test/exit-codes.test.ts`

**Out of scope**:

- Changing error codes or exit-code values.
- Changing README error-code documentation except to fix a proven mismatch.
- Refactoring error classes.

## Git Workflow

- Branch: `advisor/001-tighten-error-code-contracts`
- Commit style: Conventional Commits, e.g. `test: tighten grove error code contracts`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a table-driven exit-code unit test

Create `packages/grove-cli/test/exit-codes.test.ts` or add an equivalent focused section if the repo prefers one CLI test file. Test `exitCodeForError()` with representative errors for every mapped category in `packages/grove-cli/src/exit-codes.ts`, plus an unmapped object returning `1`.

Use plain objects like `{ code: "LEASE_CONFLICT" }`; no need to instantiate every error class.

Add an explicit comment or grouped test for branch/ref lookup failures that intentionally share exit category `13` (`BRANCH_EXISTS`, `BRANCH_NOT_FOUND`, and `REF_NOT_FOUND`). The shared exit code is deliberate and should not be "fixed" by a future refactor.

**Verify**: `pnpm test -- packages/grove-cli/test/exit-codes.test.ts` -> new test passes.

### Step 2: Replace message-only SDK assertions with code assertions

In existing lease tests, change assertions like `.rejects.toThrow(/Unsafe cleanup/)` and `.rejects.toThrow("Lease conflict")` to `.rejects.toMatchObject({ code: "..." })`. Keep a message assertion only when the message itself is the documented contract for that case.

Minimum cases to cover:

- `LEASE_CONFLICT`
- `LEASE_ALREADY_EXISTS`
- `BRANCH_NOT_FOUND`
- `UNSAFE_CLEANUP`
- `PATH_OUTSIDE_POOL`, including the existing out-of-pool destroy assertion in `packages/grove/test/lease-destroy.integration.test.ts`
- `GIT_NOT_FOUND` or `GIT_COMMAND_FAILED` in `git.test.ts`, if stable in current implementation

**Verify**: `pnpm test -- packages/grove/test/lease-acquire.integration.test.ts packages/grove/test/lease-release.integration.test.ts packages/grove/test/lease-destroy.integration.test.ts packages/grove/test/git.test.ts` -> selected tests pass.

### Step 3: Add missing detached-ref failure coverage

Add one SDK integration test for acquiring a nonexistent detached ref. Assert `.code === "REF_NOT_FOUND"` and assert useful `details` if currently emitted by `RefNotFoundError`.

Add one CLI JSON subprocess case for `grove acquire --json --lease-id <id> --ref no-such-ref -r <repo>`, expecting:

- exit code `13`
- JSON body `{ ok: false, error: { code: "REF_NOT_FOUND" } }`
- empty stderr

**Verify**: `pnpm build && pnpm test -- packages/grove/test/lease-acquire.integration.test.ts packages/grove-cli/test/cli.test.ts` -> selected tests pass.

## Test Plan

- New unit coverage for `exitCodeForError`.
- Strengthened existing SDK integration assertions for stable `.code`.
- New SDK and CLI tests for `REF_NOT_FOUND`.
- Model CLI tests after the existing missing-branch case in `packages/grove-cli/test/cli.test.ts`.

## Done Criteria

- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm build && pnpm test -- packages/grove-cli/test/cli.test.ts` exits 0.
- [ ] Targeted SDK lease tests exit 0.
- [ ] `pnpm check` exits 0.
- [ ] No production code behavior changes except fixes required by a failing contract assertion.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report if:

- A documented README error-code mapping does not match current implementation.
- A message-only assertion cannot be replaced because the thrown value is not a `GroveError`.
- Adding `REF_NOT_FOUND` tests reveals a different code is intentionally documented elsewhere.
- Verification fails twice after reasonable fixes.

## Maintenance Notes

After this lands, new public errors should include one SDK assertion on `.code` and one CLI mapping assertion when surfaced through the CLI. Reviewers should reject new message-only assertions for stable contract errors unless the message is itself the contract.
