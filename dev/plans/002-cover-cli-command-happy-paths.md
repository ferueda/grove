# Plan 002: Cover Shipped CLI Command Happy Paths

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 2219718..HEAD -- packages/grove-cli/test packages/grove-cli/src/commands packages/grove-cli/src/json-output.ts packages/grove-cli/src/suggestions.ts packages/grove-cli/test/helpers packages/grove/test/helpers`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding. On mismatch, stop.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/001-tighten-error-code-contracts.md`
- **Category**: tests
- **Planned at**: commit `2219718`, 2026-06-17

## Why this matters

The published CLI exposes `destroy`, `inspect`, and `repair`, but current subprocess tests focus mostly on acquire, list, release, status, and errors. SDK tests can pass while CLI JSON envelopes, exit codes, and stdout/stderr routing for these shipped commands regress. Grove’s README promises stable `--json` envelopes, so this is a public contract test gap.

## Current State

- `packages/grove-cli/test/cli.test.ts` runs the built CLI through `node dist/cli.js`.
- The test helper `packages/grove-cli/test/helpers/seed-lease.ts` seeds pool state through the SDK.
- Current CLI tests include `acquire`, `list`, `release`, `status`, `commands`, and invalid `repair` action.
- There are command implementations for `destroy`, `inspect`, and `repair` under `packages/grove-cli/src/commands/`.

Relevant excerpts:

```ts
// packages/grove-cli/test/cli.test.ts
const CLI_PATH = join(import.meta.dirname, "..", "dist", "cli.js");

async function runCli(args: string[], env: Record<string, string>) {
  return execa("node", [CLI_PATH, ...args], {
    env: { ...process.env, ...env },
    reject: false,
  });
}
```

```ts
// packages/grove-cli/test/cli.test.ts
it("repair --json rejects invalid action with structured INVALID_INPUT", async () => {
  // invalid-action coverage exists, but no repair success path exists.
});
```

Repo conventions to follow:

- Build before CLI subprocess tests because they execute `dist/cli.js`.
- Seed state through SDK helpers for `list`, `release`, and similar command tests.
- Keep JSON mode stdout machine-readable only; stderr should be empty for success and JSON-routed errors.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Build CLI | `pnpm build` | exit 0 |
| Targeted CLI tests | `pnpm test -- packages/grove-cli/test/cli.test.ts` | all CLI tests pass |
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Full verification | `pnpm check` | exit 0 |

## Scope

**In scope**:

- `packages/grove-cli/test/cli.test.ts`
- `packages/grove-cli/test/helpers/seed-lease.ts` only if a tiny helper extension is needed

**Out of scope**:

- Changing CLI command implementations unless a test exposes a real contract bug.
- Changing JSON envelope shape.
- Adding broad snapshot tests.

## Git Workflow

- Branch: `advisor/002-cover-cli-command-happy-paths`
- Commit style: Conventional Commits, e.g. `test: cover cli inspect destroy repair paths`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add `inspect --json` happy-path subprocess coverage

Seed a lease with `seedLease()`. Run:

`grove inspect --json --lease-id <id> -r <repo>`

Assert:

- exit code `0`
- stdout JSON matches `{ ok: true, lease: { leaseId: <id>, state: "leased" } }`
- suggestions shape is present if current command emits it
- stderr is empty

**Verify**: `pnpm build && pnpm test -- packages/grove-cli/test/cli.test.ts -t inspect` -> inspect test passes.

### Step 2: Add `destroy --json` happy-path subprocess coverage

Seed a lease. Run:

`grove destroy --json --lease-id <id> --force -r <repo>`

Use `--force` if needed to avoid platform-specific process-safety uncertainty in CI. Assert:

- exit code `0`
- stdout JSON matches the command’s current success contract
- stderr is empty
- a follow-up CLI `inspect --json --lease-id <id> -r <repo>` returns structured not-found output:
  - exit code `8`
  - stdout JSON matches `{ ok: false, error: { code: "LEASE_NOT_FOUND" } }`
  - stderr is empty

**Verify**: `pnpm build && pnpm test -- packages/grove-cli/test/cli.test.ts -t destroy` -> destroy test passes.

### Step 3: Add `repair --json` successful action coverage

Choose the simplest stable successful repair flow from existing SDK integration tests:

- Prefer `action: "quarantine"` on a leased lease if the command supports it.
- If quarantine is not valid from a leased state, seed or create the same state shape used in `packages/grove/test/lease-repair.integration.test.ts`.

Run:

`grove repair --json --lease-id <id> --action quarantine -r <repo>`

Assert:

- exit code `0`
- stdout JSON has `ok: true` and uses the command's current `result` envelope:
  - `body.result.status === "quarantined"`
  - `body.result.leaseId === <id>`
  - `body.result.lease.leaseId === <id>` if the current result includes a lease object
- suggestions shape is present if current command emits it
- stderr is empty

**Verify**: `pnpm build && pnpm test -- packages/grove-cli/test/cli.test.ts -t repair` -> repair tests pass.

### Step 4: Keep tests readable

If `cli.test.ts` becomes noisy, extract small local helper functions in the test file only, such as `parseJson(result)` or `expectSuccessStdoutOnly(result)`. Do not introduce a new test framework abstraction.

**Verify**: `pnpm typecheck` -> exit 0.

## Test Plan

- New subprocess test for `inspect --json`.
- New subprocess test for `destroy --json`.
- New subprocess test for successful `repair --json`.
- Existing CLI tests remain passing.

## Done Criteria

- [ ] `pnpm build && pnpm test -- packages/grove-cli/test/cli.test.ts` exits 0.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm check` exits 0.
- [ ] Success cases assert stdout JSON and empty stderr.
- [ ] No source files outside test/helper scope changed unless a real contract bug was found.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report if:

- The current command success envelope is ambiguous or contradicts README.
- A happy-path command cannot pass without changing public JSON shape.
- The easiest repair success path requires hand-writing invalid state.
- Verification fails twice after reasonable fixes.

## Maintenance Notes

Future CLI commands should get one subprocess happy-path test and at least one structured error test before release. Keep using real `dist/cli.js` subprocesses for public command behavior.
