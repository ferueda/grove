# Grove Test Suite Speedup Implementation Plan

Status: planned.

Source reference: user request after PR #44 validation run and local timing analysis from
`/tmp/grove-test-2.log`.

## Goal

Reduce Grove's full test-suite wall time while preserving the test boundaries that
matter for a git worktree manager:

- real Git coverage for worktree, branch, lock, process, cleanup, and CLI paths;
- stable CLI JSON and exit-code contracts;
- durable lease recovery behavior under realistic filesystem state;
- no broad mocking of core Git behavior in integration tests.

Target outcome for the first speedup PR:

- reduce full `pnpm test` wall time from roughly 7 minutes to under 4 minutes on
  the same local machine class;
- keep focused lease and CLI tests easy to run during feature work;
- make slow tests explainable by file and scenario.

Stretch target after follow-up splitting:

- full suite under 3 minutes locally without weakening coverage intent.

## Contract

- Keep real Git in integration tests that verify worktree behavior, branch
  behavior, process safety, cleanup, repair, and CLI subprocess contracts.
- Do not replace lease integration tests with mocks.
- Keep at least one default-fetch acquire path covered.
- Keep at least one full CLI acquire path through `dist/cli.js`.
- CLI tests must continue to assert stdout/stderr separation, JSON envelope
  shape, and mapped exit codes.
- State/transition/config tests should avoid real Git when their behavior does
  not depend on Git.
- Test changes must encode why behavior matters, not only reduce runtime.
- Production behavior changes are allowed only when they remove redundant work
  or clarify existing contracts.

## Why

The v1 lease-first suite now exercises realistic Git, worktree, hook, process,
repair, and CLI flows. That is valuable, but the current organization pays real
Git setup costs repeatedly and serializes too much work inside one integration
file.

The latest full verbose run passed but took:

- `Test Files`: 12 passed
- `Tests`: 145 passed
- `Duration`: 423.12s wall time
- aggregate test time reported by Vitest: 640.63s

Slow tests make review loops expensive and push agents toward running only
focused subsets. The goal is to make the full suite cheap enough to run
regularly while preserving confidence.

## Current Reality

Verified from the current PR #44 branch.

### Slowest Files By Aggregate Test Time

| File | Aggregate test time |
| ---- | ------------------- |
| `packages/grove/test/lease.integration.test.ts` | ~285s |
| `packages/grove-cli/test/cli.test.ts` | ~88s |
| `packages/grove/test/git.test.ts` | ~74s |
| `packages/grove/test/grove.integration.test.ts` | ~63s |
| `packages/grove/test/state-v1.test.ts` | ~53s |
| `packages/grove/test/state.test.ts` | ~36s |

### Slowest Individual Tests

| Test | Time |
| ---- | ---- |
| CLI explicit branch reuse | ~28s |
| parallel child-process acquire | ~20s |
| createGrove -> acquire -> release smoke | ~18s |
| branch reacquire with commit | ~17s |
| release on quarantined lease | ~16s |
| acquire idempotency | ~15s |
| CLI list envelope | ~14s |
| CLI release envelope | ~13s |
| CLI error envelope | ~13s |

### Repeated Cost Sources

`setupRepo()` currently does full remote-capable setup for every caller:

- `git init --bare`
- `git init`
- `git remote add origin`
- write README through a spawned `node -e`
- `git add`
- `git config user.name`
- `git config user.email`
- `git commit`
- `git branch -M main`
- `git push -u origin main`

Approximate use counts:

- `lease.integration.test.ts`: 36 `setupRepo()` calls, 36 `createGrove()` calls,
  45 `acquire()` calls
- `cli.test.ts`: 6 `setupRepo()` calls, repeated `node dist/cli.js` subprocesses
- `config.test.ts`: 5 `setupRepo()` calls for path-resolution tests
- `state-v1.test.ts`, `state.test.ts`, `target.test.ts`, `git.test.ts`: one
  `setupRepo()` each, with some tests not requiring a remote

### Duplicate Fetch

`Grove.acquire()` calls `fetchOrigin()` and then delegates to `acquireLease()`.
`acquireLease()` also calls `fetchOrigin()`.

`acquireLease()` is currently only called by `Grove.acquire()`, so most public
SDK and CLI acquire paths pay two `git fetch origin` calls when fetch is enabled.
This is both production overhead and test overhead.

### Vitest Parallelism

`vitest.config.ts` currently uses:

- `testTimeout: 60_000`
- `hookTimeout: 60_000`
- `maxWorkers: 2`

The worker cap is reasonable for stability because the suite creates many Git
worktrees, child processes, locks, and temporary repos. The larger problem is
that `lease.integration.test.ts` is a single long serial file, so it becomes the
critical path even with two workers.

## Scope

Included:

- remove duplicate production fetch;
- add cheaper test fixtures for tests that do not need remote Git;
- disable fetch in integration tests that do not explicitly verify fetch;
- reduce CLI setup cost while retaining CLI subprocess coverage;
- split the largest integration file into behavior-oriented files;
- add lightweight timing visibility so future regressions are obvious.

Excluded:

- broad Git mocking in integration tests;
- replacing CLI subprocess tests with direct SDK tests;
- changing Grove's public API;
- raising timeouts as the primary fix;
- changing release semantics, repair semantics, or branch policy behavior.

## Assumptions And Open Questions

- Assumption: local remote fetch behavior only needs explicit coverage in
  `git.test.ts` and one public acquire smoke path. Most lease integration tests
  can set `fetchOnAcquire: false`.
- Assumption: config path-resolution tests do not need a real Git repo and can
  use filesystem-only directories.
- Assumption: splitting `lease.integration.test.ts` will improve wall time once
  the current single-file critical path is removed.
- Open question: whether CI runners can safely use more than 2 workers after the
  file split. Recommendation: keep `maxWorkers: 2` in the first PR; benchmark
  `maxWorkers: 3` only after fixture cost is reduced.

## Pre-Implementation Validation

Before editing, capture a fresh baseline on the implementation machine:

- full suite wall time;
- slowest tests from verbose reporter output;
- aggregate test time by file;
- focused runtime for `lease.integration.test.ts`;
- focused runtime for `cli.test.ts`.

Expected current signal:

- `lease.integration.test.ts` dominates aggregate and wall time;
- CLI tests are expensive because they repeatedly spawn `node dist/cli.js` and
  create full remote repos;
- many tests pay default fetch despite not validating fetch.

## Implementation Phases

### Phase 1: Remove Duplicate Fetch

What:

- Ensure public `Grove.acquire()` fetches at most once per acquire.

How:

- Keep fetch policy in `Grove.acquire()` because it is the public SDK boundary.
- Remove fetch handling from internal `acquireLease()`.
- Keep `AcquireLeaseOptions.fetchOnAcquire` and `GroveConfig.fetchOnAcquire`
  semantics unchanged at the public API boundary.
- Add or update a focused test that proves disabling fetch at the public boundary
  still avoids fetch-related behavior.

Why:

- This removes redundant production work and reduces every acquire-heavy test.
- It is low risk because `acquireLease()` has no other current callers.

Where:

- `packages/grove/src/pool.ts`
- `packages/grove/src/lease-acquire.ts`
- focused SDK tests near acquire behavior

Tests:

- focused acquire tests;
- full `git.test.ts`;
- full suite.

Exit Criteria:

- Public acquire still fetches by default.
- `fetchOnAcquire: false` still disables fetch.
- No double fetch path remains.

Risks:

- Future internal callers of `acquireLease()` may expect fetch. Mitigate by
  keeping fetch policy documented in the public facade and naming
  `acquireLease()` as an internal mutator.

### Phase 2: Add Cheaper Test Fixtures

What:

- Split the single full remote fixture into purpose-specific fixtures.

How:

- Keep current `setupRepo()` as the full remote fixture.
- Add `setupLocalRepo()` for tests that need a committed Git repo but no remote
  or push.
- Add `setupPathFixture()` or inline temp-directory setup for config/path tests
  that do not need Git at all.
- Replace spawned `node -e` file writes in fixtures with `writeFile()`.
- Keep helper names explicit so tests reveal whether they depend on remote
  behavior.

Why:

- Full remote setup is expensive and currently used by tests that only need a
  repo path, a HEAD commit, or a temporary directory.

Where:

- `packages/grove/test/helpers/git-repo.ts`
- `packages/grove/test/config.test.ts`
- `packages/grove/test/state-v1.test.ts`
- `packages/grove/test/state.test.ts`
- `packages/grove/test/target.test.ts`
- selected `packages/grove/test/git.test.ts`

Tests:

- full config/state/target/git tests;
- full suite.

Exit Criteria:

- Tests that require remote behavior still use `setupRepo()`.
- Tests that do not require remote behavior no longer pay bare remote + push.
- No test depends on fixture implementation details accidentally.

Risks:

- A test may silently stop covering remote behavior. Mitigate by naming fixtures
  clearly and keeping explicit remote/fetch tests.

### Phase 3: Disable Fetch In Most Integration Tests

What:

- Set `fetchOnAcquire: false` in tests where fetch is irrelevant.

How:

- Add a small test helper such as `createTestGrove()` that defaults
  `fetchOnAcquire` to false unless a test opts into default fetch.
- Replace repetitive `createGrove({ repoRoot, groveRoot })` calls in lease tests
  with the helper.
- Keep explicit default-fetch coverage in a small number of tests.

Why:

- Most lease integration tests care about state transitions, cleanup, repair,
  hooks, process safety, or branch/ref behavior. They do not need to exercise
  `git fetch origin` every time.

Where:

- `packages/grove/test/lease.integration.test.ts`
- `packages/grove/test/grove.integration.test.ts`
- `packages/grove-cli/test/cli.test.ts` through CLI env/options only if a CLI
  fetch-disable surface exists or is added intentionally

Tests:

- focused lease integration tests;
- one default-fetch acquire smoke;
- full suite.

Exit Criteria:

- Runtime for acquire-heavy tests drops measurably.
- Fetch behavior still has explicit coverage.

Risks:

- CLI currently has no visible fetch-disable flag. Do not add one only for tests
  unless it is a useful public/operator option. Prefer fixture and CLI setup
  reductions first for CLI tests.

### Phase 4: Split Lease Integration By Behavior

What:

- Break `lease.integration.test.ts` into smaller files grouped by behavior.

How:

- Create files along these lines:
  - `lease-acquire.integration.test.ts`
  - `lease-release.integration.test.ts`
  - `lease-repair.integration.test.ts`
  - `lease-destroy.integration.test.ts`
  - `lease-hooks.integration.test.ts`
- Move tests without changing assertions first.
- Keep shared helpers in a small support file if needed.
- Avoid introducing nested abstractions just to shorten files.

Why:

- Vitest parallelizes across files, not individual serial tests inside one file.
  The current lease file is the wall-time critical path.

Where:

- `packages/grove/test/lease.integration.test.ts`
- new files under `packages/grove/test/`

Tests:

- all moved lease integration files;
- full suite.

Exit Criteria:

- No tests are removed.
- Focused file names make ownership clearer.
- Full suite wall time improves because lease scenarios can run across workers.

Risks:

- Shared setup helpers can become too abstract. Keep test names and local setup
  readable.

### Phase 5: Trim CLI Setup Cost

What:

- Keep CLI subprocess contract coverage but avoid using CLI acquire as setup for
  every command test.

How:

- Keep one full `grove acquire --json` test through `dist/cli.js`.
- For `list`, `release`, and selected error-envelope tests, seed state through
  SDK or state helpers, then run only the CLI command under test.
- Keep one CLI test that exercises an acquire error path through the command.
- Consider combining branch-reuse failure and success into one test only if it
  remains readable; it is currently the slowest individual test.

Why:

- CLI tests should protect command parsing, JSON envelopes, stdout/stderr, and
  exit-code mapping. They do not all need to pay full acquire setup through a
  subprocess.

Where:

- `packages/grove-cli/test/cli.test.ts`
- optional test support helper under `packages/grove-cli/test/` or
  `packages/grove/test/helpers/`

Tests:

- full CLI test file;
- full suite.

Exit Criteria:

- CLI contract assertions are preserved.
- CLI file runtime drops materially.
- At least one acquire happy path and one acquire error path still run through
  CLI subprocesses.

Risks:

- Seeded state can drift from production-created state. Mitigate by using SDK
  setup where practical and preserving one full CLI acquire path.

### Phase 6: Add Timing Guardrails

What:

- Make slow-test regressions visible without requiring manual log parsing.

How:

- Add a lightweight script that parses Vitest verbose output and prints:
  - slowest tests;
  - aggregate time by file;
  - total wall time.
- Store output only in temp/log artifacts; do not commit generated timing files.
- Optionally add a package script such as `test:timed`.

Why:

- The suite will continue to include real Git tests. A small report keeps future
  slowdown discussions evidence-based.

Where:

- `scripts/`
- `package.json`

Tests:

- script smoke test if the repo has script tests;
- otherwise manual verification during the speedup PR.

Exit Criteria:

- Maintainers can identify slow tests from one command.
- No CI dependency on machine-specific timing thresholds in the first PR.

Risks:

- Hard timing thresholds can be flaky. Start with reporting, not enforcement.

## Verification

Required after each implementation phase:

- affected focused test file(s);
- `pnpm lint`;
- `pnpm build`;
- `pnpm typecheck`;
- full `pnpm test` after the final phase of each PR.

Required timing evidence for the PR summary:

- before/after full suite wall time;
- before/after `lease.integration` or split lease file aggregate;
- before/after CLI test file runtime;
- list of tests moved, seeded, or changed.

Acceptance scenarios:

- default acquire still fetches once by default;
- `fetchOnAcquire: false` skips fetch;
- all lease repair and cleanup regressions still pass;
- CLI JSON stdout/stderr contract still passes;
- real Git worktree add/remove/reset/fetch tests still pass.

## Documentation And Cleanup

- Update `README.md` only if public CLI flags or SDK behavior changes.
- Update `AGENTS.md` only if test-layer conventions change, for example:
  - when to use full remote fixture;
  - when to use local repo fixture;
  - when CLI tests may seed state.
- Keep timing logs out of the repo.
- Do not commit generated build output.

## Suggested PR Breakdown

### PR 1: Low-Risk Runtime Win

- remove duplicate fetch;
- add local/path fixture helpers;
- move config/state/path-only tests off full remote setup;
- replace fixture `node -e` writes with `writeFile()`;
- add timing report script if small.

### PR 2: Lease Integration Split

- split `lease.integration.test.ts` by behavior;
- introduce minimal shared test helpers;
- preserve assertions and test names where practical.

### PR 3: CLI Test Setup Reduction

- keep essential full CLI acquire coverage;
- seed state for command-focused CLI tests;
- document CLI test-layer boundary if needed.

This ordering keeps the first PR small and production-beneficial, then handles
test organization separately from CLI contract changes.
