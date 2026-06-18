# Plan 007: Avoid Duplicate Process Scans During Lease Listing

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 2219718..HEAD -- packages/grove/src/lease-view.ts packages/grove/src/process/detect.ts packages/grove/test packages/grove-cli/test/cli.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding. On mismatch, stop.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `2219718`, 2026-06-17

## Why this matters

Process detection is intentionally conservative and can be expensive: Linux scans `/proc`, while macOS runs `lsof`. `list({ includeProcesses: true })` currently calls `findInWorktree()` for diagnostics, then `enrichLeaseReadOnly()` calls it again for the same lease. This doubles the most expensive part of list/inspect enrichment for a common agent-facing command.

## Current State

- `packages/grove/src/lease-view.ts` builds public `GroveLease` views.
- `listLeaseRecords()` optionally includes process diagnostics.
- `enrichLeaseReadOnly()` always runs process-safety enrichment for existing paths.

Relevant excerpts:

```ts
// packages/grove/src/lease-view.ts
if (options?.includeProcesses && existsSync(copy.path)) {
  const scan = await findInWorktree(copy.path);
  copy.diagnostics = {
    ...copy.diagnostics,
    lastProcessSafetyCheck: {
      status: scan.unverified ? "unverified" : "verified",
      checkedAt: new Date().toISOString(),
      processes: scan.processes,
    },
  };
}
leases.push(await enrichLeaseReadOnly(copy));
```

```ts
// packages/grove/src/lease-view.ts
const { unverified } = missingPath ? { unverified: true } : await findInWorktree(lease.path);
```

Repo conventions to follow:

- Keep read-side enrichment best-effort.
- Do not persist diagnostics from list/inspect unless the existing code already writes state.
- Keep API shape additive/stable.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Targeted tests | `pnpm test -- packages/grove/test/process.test.ts packages/grove-cli/test/cli.test.ts` | selected tests pass |
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Full verification | `pnpm check` | exit 0 |

## Scope

**In scope**:

- `packages/grove/src/lease-view.ts`
- A focused test file under `packages/grove/test/` if needed
- `packages/grove-cli/test/cli.test.ts` only if CLI list/status behavior needs a regression assertion

**Out of scope**:

- Replacing process detection.
- Adding global process-scan caching.
- Changing `GroveLease` public fields.

## Git Workflow

- Branch: `advisor/007-avoid-duplicate-process-scans`
- Commit style: Conventional Commits, e.g. `perf: avoid duplicate process scans in list`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a small characterization test if practical

Prefer a unit-level test for `listLeaseRecords()` that can spy on process detection. If the module structure makes spying awkward under ESM, skip direct call-count testing and assert only output shape; do not over-refactor just to spy.

Expected behavior:

- `includeProcesses: true` still includes `diagnostics.lastProcessSafetyCheck.processes`.
- `processSafety` remains `"verified"` or `"unverified"` as before.

**Verify**: `pnpm test -- packages/grove/test/process.test.ts` or the new focused test file -> selected tests pass.

### Step 2: Thread the scan result into enrichment

Change `enrichLeaseReadOnly()` to accept an optional process scan result or optional diagnostics input. For example:

```ts
export async function enrichLeaseReadOnly(
  lease: GroveLeaseRecord,
  scan?: ProcessScanResult,
): Promise<GroveLease> {
  // use scan when provided; otherwise call findInWorktree as today
}
```

Then pass the scan from `listLeaseRecords()` when `includeProcesses` is enabled.

Keep `inspectLeaseRecord()` behavior unchanged by letting it call `enrichLeaseReadOnly()` without a scan.

**Verify**: `pnpm typecheck` -> exit 0.

### Step 3: Preserve output shape

Ensure `list --json --include-processes` or the equivalent SDK path still emits processes in diagnostics. If no CLI flag exists for include-processes, verify SDK-level output only.

**Verify**: `pnpm test -- packages/grove-cli/test/cli.test.ts` -> CLI tests pass.

## Test Plan

- Existing CLI list/status tests remain passing.
- Add focused unit/SDK test only if it can be done without brittle ESM mocking.
- If no call-count test is feasible, rely on code review plus unchanged output tests.

## Done Criteria

- [ ] `listLeaseRecords()` does not call `findInWorktree()` twice for the same lease when `includeProcesses` is true.
- [ ] `inspectLeaseRecord()` behavior is unchanged.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm check` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report if:

- Avoiding the duplicate scan requires changing public output shape.
- A call-count test requires invasive module refactoring.
- The process-scan result cannot safely be reused because timestamps/status semantics differ.
- Verification fails twice after reasonable fixes.

## Maintenance Notes

This plan intentionally avoids broader scan caching. If list latency remains high after this change, plan a separate operation-scoped cache with explicit invalidation and safety review.
