# Plan 260612-cli-agent-discoverability: Add agent-friendly CLI discovery without changing Grove scope

> **Completed** in [PR #56](https://github.com/ferueda/grove/pull/56) (`feat/cli-agent-discoverability`). Archived after implementation and review.

## Status

- **State**: completed
- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: dx
- **Issue**: [https://github.com/ferueda/grove/issues/54](https://github.com/ferueda/grove/issues/54)
- **PR**: [https://github.com/ferueda/grove/pull/56](https://github.com/ferueda/grove/pull/56)

## Why this matters

Grove is a lease-first git worktree pool for downstream orchestrators, bots, and CLIs. Those consumers benefit when each CLI response contains enough structured data to decide the next action without extra inspection calls or README parsing. This plan adds high-leverage, additive CLI ergonomics: richer recoverable error details, list aggregates, lightweight state-based suggestions, and machine-readable discovery/status commands. It must not turn Grove into an agent runner, workflow manager, PR system, or policy engine.

## Current state

Project intent:

- `VISION.md` says Grove's north star is "durable, branch-aware leases keyed by `leaseId`".
- `VISION.md` also says Grove should not be "an agent runner or workflow manager", "an opinionated PR/review/validation system", or a config-file-driven product.
- `AGENTS.md` says CLI tests should seed state through the SDK for `list`, `release`, and error envelopes, and preserve full `dist/cli.js` subprocess coverage for acquire paths.

Relevant files and current roles:

- `packages/grove-cli/src/json-output.ts` — JSON response envelope helpers.
- `packages/grove-cli/src/error-handler.ts` — maps thrown errors into JSON or human-mode output.
- `packages/grove-cli/src/cli.ts` — Commander root; registers all commands.
- `packages/grove-cli/src/commands/*.ts` — command handlers that directly call `writeJson(...)`.
- `packages/grove-cli/src/utils.ts` — resolves repo root and creates the SDK client.
- `skills/grove/SKILL.md` — does not exist yet; this plan will add an Agent Skills format guide for agents using Grove.
- `packages/grove/src/errors.ts` — stable error classes and `code` values.
- `packages/grove/src/pool.ts` — public SDK facade; currently exposes `list()` but no stats method.
- `packages/grove/src/pool-state.ts` — loads/heals state and has slot/lease access helpers.
- `packages/grove/src/target.ts` — detects reacquire conflicts and throws several recoverable lease errors.
- `packages/grove-cli/test/cli.test.ts` — subprocess tests for stable JSON CLI behavior.

Current envelope implementation:

```typescript
// packages/grove-cli/src/json-output.ts
export type JsonErrorEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
};

export function leasesEnvelope<T>(leases: T): JsonLeasesEnvelope<T> {
  return { ok: true, leases };
}
```

Current error details behavior:

```typescript
// packages/grove-cli/src/error-handler.ts
if (jsonEnabled) {
  const code = err instanceof GroveError ? err.code : "UNKNOWN_ERROR";
  const message = err instanceof Error ? err.message : String(err);
  const details: Record<string, unknown> = {};
  if (err instanceof GitCommandError && err.stderr) {
    details.stderr = err.stderr;
  }
  process.stdout.write(JSON.stringify(errorEnvelope(code, message, details)) + "\n");
  process.exit(exitCode);
}
```

Current list behavior:

```typescript
// packages/grove-cli/src/commands/list.ts
const grove = await loadGrove({ repo: options.repo });
const leases = await grove.list({
  includeProcesses: options.includeProcesses,
});

if (options.json) {
  writeJson(leasesEnvelope(leases));
  return;
}
```

Current SDK list shape:

```typescript
// packages/grove/src/pool.ts
async list(options?: { includeProcesses?: boolean }): Promise<readonly GroveLease[]> {
  let leases: GroveLease[] = [];
  await withStateLock(this.poolDir, async () => {
    const state = await loadPoolState(this.poolDir, this.config.repoRoot);
    leases = await listLeaseRecords(state, options);
  });
  return leases;
}
```

Current config/default capacity:

```typescript
// packages/grove/src/schemas.ts
export const GroveConfigSchema = z.object({
  repoRoot: z.string(),
  groveDir: z.string().optional(),
  groveRoot: z.string().optional(),
  maxTrees: z.number().optional().default(16),
  // ...
});
```

Current conflict source:

```typescript
// packages/grove/src/target.ts
if (requested.branch !== stored.branch) {
  throw new LeaseConflictError(
    `Lease conflict: requested branch ${requested.branch}, existing has ${stored.branch}`,
  );
}
```

Current CLI tests already assert JSON stdout-only mode:

```typescript
// packages/grove-cli/test/cli.test.ts
expect(result.exitCode).toBe(0);
const body = JSON.parse(result.stdout);
expect(body.ok).toBe(true);
expect(body.leases).toHaveLength(1);
expect(result.stderr).toBe("");
```

Agent Skills examples to match:

- `lavish-axi` skill uses YAML frontmatter with `name`, `description`, `argument-hint`, `author`, and `metadata.hermes`.
- `gh-axi` skill uses YAML frontmatter with `name`, `description`, `user-invocable`, `author`, and `metadata.hermes`.
- Both keep the body practical: when to use, workflow, commands, and tips.
- Grove's skill should follow that style, but describe Grove's actual CLI and scope.

Repo conventions to match:

- TypeScript, Node `>=24`, ESM-only.
- Use `zod` at boundaries when validating persisted state or config.
- Throw explicit `GroveError` subclasses with stable `code` properties.
- Route lease/slot state mutations through transition helpers. This plan should not add mutations.
- CLI JSON mode must write machine-readable JSON to stdout only; human mode prose goes to stderr.
- CLI tests use real git via `setupRepo()` and SDK seeding via `seedLease()`. Do not mock git.

## Commands you will need


| Purpose                                   | Command                                            | Expected on success          |
| ----------------------------------------- | -------------------------------------------------- | ---------------------------- |
| Install                                   | `pnpm install`                                     | exit 0                       |
| Build                                     | `pnpm build`                                       | exit 0                       |
| Typecheck                                 | `pnpm typecheck`                                   | exit 0, no errors            |
| CLI tests                                 | `pnpm test -- packages/grove-cli/test/cli.test.ts` | exit 0, all CLI tests pass   |
| Core tests likely touched by errors/stats | `pnpm test -- packages/grove/test`                 | exit 0, all Grove tests pass |
| Lint                                      | `pnpm lint`                                        | exit 0, no warnings          |
| Full gate                                 | `pnpm check`                                       | exit 0                       |


## Suggested Executor Toolkit

- Use the repo's Vitest guidance when adding or changing tests.
- Use TypeScript refactor guidance for exported types and discriminated unions.
- Keep edits surgical. The first implementation should be additive and compatibility-preserving.

## Scope

**In scope**:

- `packages/grove/src/errors.ts`
- `packages/grove/src/target.ts`
- `packages/grove/src/pool.ts`
- `packages/grove/src/index.ts`
- `packages/grove/src/types.ts` or a small new SDK type module if needed
- `packages/grove-cli/src/json-output.ts`
- `packages/grove-cli/src/error-handler.ts`
- `packages/grove-cli/src/utils.ts`
- `packages/grove-cli/src/cli.ts`
- `packages/grove-cli/src/commands/list.ts`
- New CLI helpers under `packages/grove-cli/src/`, for example:
  - `suggestions.ts`
  - `commands/catalog.ts`
  - `commands/status.ts`
- `packages/grove-cli/test/cli.test.ts`
- `skills/grove/SKILL.md`
- README sections that document new additive JSON fields and new commands, if commands are added.

**Out of scope**:

- Do not add MCP support.
- Do not add lifecycle/workflow commands such as `run`, `validate`, `review`, or PR automation.
- Do not add config file loaders.
- Do not make brief lease output the default in this plan.
- Do not change existing top-level success envelope keys (`lease`, `leases`, `result`) in this plan.
- Do not unify `repair` envelopes in this plan.
- Do not default JSON mode based on TTY detection in this plan.
- Do not alter checkout, release, destroy, repair, or transition semantics.

## Decisions

1. **Keep changes additive for v0.x compatibility.** Existing consumers that parse `lease`, `leases`, or `result` should keep working.
2. **Use camelCase JSON keys.** The project's TypeScript API uses camelCase (`leaseId`, `currentHeadSha`). Use `byState`, not `by_state`.
3. **Call the guidance field `suggestions`.** Use structured entries instead of bare strings so callers can choose display text or command text. Shape:

```typescript
type CliSuggestion = {
  command: string;
  reason: string;
};
```

1. **Make suggestions advisory, not policy.** They should expose Grove-native next steps only: inspect, release, repair, destroy. They must not recommend external workflow steps.
2. **Expose stats through the SDK, not by duplicating state reads in CLI.** Add a read-only SDK method so CLI and future callers share the same state/capacity logic.
3. **Make `status` the dashboard command.** Add `grove status --json` instead of changing no-args behavior. This avoids surprising human users and keeps Commander help intact.
4. **Add `commands --json` only if discovery is still desired after P0.** It is lower risk than making agents parse Commander help.
5. **Ship a Grove Agent Skill as documentation, not runtime code.** `skills/grove/SKILL.md` should teach agents how to use the CLI safely. It must not add product behavior or imply Grove runs workflows.

## Data Contracts

Additive `list --json` target:

```json
{
  "ok": true,
  "count": 2,
  "byState": { "leased": 1, "quarantined": 1 },
  "pool": { "used": 2, "max": 16, "available": 14 },
  "leases": [],
  "suggestions": [
    {
      "command": "grove inspect --json --lease-id <leaseId>",
      "reason": "Inspect a lease for full details."
    }
  ]
}
```

Additive success envelope target:

```json
{
  "ok": true,
  "lease": {},
  "suggestions": [
    {
      "command": "grove release --json --lease-id job1 --cleanup preserve",
      "reason": "Release this leased worktree when the caller is done."
    }
  ]
}
```

Structured recoverable error target:

```json
{
  "ok": false,
  "error": {
    "code": "LEASE_CONFLICT",
    "message": "Lease conflict: requested branch branch-b, existing has branch-a",
    "details": {
      "leaseId": "conflict-lease",
      "existingState": "leased",
      "existingTarget": { "mode": "branch", "branch": "branch-a" },
      "requestedTarget": { "mode": "branch", "branch": "branch-b" }
    }
  }
}
```

## Steps

### Phase 1: Add structured error details for recoverable errors

What to build:

- Extend `GroveError` in `packages/grove/src/errors.ts` to optionally carry `details: Record<string, unknown>`.
- Preserve every existing error `code` and message.
- Update subclasses only where useful. Start with these recoverable cases:
  - `LeaseConflictError`
  - `LeaseBusyError`
  - `AcquireInProgressError`
  - `LeaseQuarantinedError`
  - `GroveExhaustedError` or `PoolExhaustedError`, depending on which class is used by current pool exhaustion paths.
- Update `packages/grove-cli/src/error-handler.ts` so JSON mode emits `err.details` when `err instanceof GroveError`.
- Preserve git stderr behavior, but merge it into details instead of replacing details.

Implementation shape:

```typescript
export class GroveError extends Error {
  readonly code: GroveErrorCode;
  readonly details: Record<string, unknown>;

  constructor(message: string, code: GroveErrorCode, details: Record<string, unknown> = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}
```

Then update `LeaseConflictError` similarly:

```typescript
export class LeaseConflictError extends GroveError {
  constructor(message: string = "Lease conflict", details: Record<string, unknown> = {}) {
    super(message, "LEASE_CONFLICT", details);
  }
}
```

Update `packages/grove/src/target.ts` where reacquire conflicts are detected. Include only stable, JSON-safe fields:

- `leaseId`
- `existingState`
- `existingTarget`
- `requestedTarget`
- mismatch-specific fields like `existingBranch`, `requestedBranch`, `existingCreateFromRef`, `requestedCreateFromRef`

Do not include filesystem scans, process lists, stack traces, or full git output in these structured details.

Test changes:

- Update the existing CLI test `"errors use stable JSON envelope on stdout with mapped exit code"`.
- It currently expects `details: {}`. Change it to assert useful conflict details.
- Add one SDK-level test only if the CLI test cannot exercise the details cleanly. Prefer the existing CLI test first.

Verify:

`pnpm test -- packages/grove-cli/test/cli.test.ts` -> exit 0; conflict test expects non-empty `error.details`.

### Phase 2: Add read-only pool stats in the SDK

What to build:

- Add a small exported type for pool stats. Suggested location: `packages/grove/src/types.ts`.

```typescript
export type GroveLeaseState = GroveLease["state"];

export type GrovePoolStats = {
  count: number;
  byState: Partial<Record<GroveLeaseState, number>>;
  pool: {
    used: number;
    max: number;
    available: number;
  };
};
```

- Add `stats(): Promise<GrovePoolStats>` to `Grove` in `packages/grove/src/pool.ts`.
- Read state under `withStateLock`, using `loadPoolState(...)`.
- Compute:
  - `count`: `state.leases.length`
  - `byState`: counts from `state.leases`
  - `pool.used`: count of slots unavailable for new clean leases. Recommended first implementation: `state.slots.length`, because existing allocation compares total slots against `maxTrees`.
  - `pool.max`: `this.config.maxTrees ?? 16`. Since `createGrove()` parses defaults, `this.config.maxTrees` should be defined, but keep `?? 16` for type clarity.
  - `pool.available`: `Math.max(0, max - state.slots.length)`

Important nuance:

- Do not define `pool.used` as only active lease count. Allocation uses `state.slots.length >= maxTrees`, so slots that are quarantined/destroying still consume capacity until repaired/destroyed. This matters for answering "is the pool full?"
- Export `GrovePoolStats` from `packages/grove/src/index.ts`.

Test changes:

- Add tests through CLI in Phase 3. SDK-only tests are optional unless stats logic becomes complex.

Verify:

`pnpm typecheck` -> exit 0, no errors.

### Phase 3: Add `list --json` aggregates

What to build:

- Update `packages/grove-cli/src/json-output.ts` to support metadata on success envelopes without breaking existing shapes.
- Keep `leasesEnvelope(leases)` usable, but add an optional second argument:

```typescript
export type JsonLeasesEnvelope<T> = {
  ok: true;
  leases: T;
  count?: number;
  byState?: Record<string, number>;
  pool?: { used: number; max: number; available: number };
  suggestions?: readonly CliSuggestion[];
};
```

Better approach:

- Define a reusable `JsonSuccessExtras` type with optional `suggestions`.
- Define `JsonListExtras` for `count`, `byState`, `pool`.
- Keep functions simple and explicit.
- Update `packages/grove-cli/src/commands/list.ts`:
  - Fetch `leases` as today.
  - Fetch `stats` via `grove.stats()`.
  - Emit:

```typescript
writeJson(leasesEnvelope(leases, {
  count: stats.count,
  byState: stats.byState,
  pool: stats.pool,
  suggestions: suggestionsForList(stats),
}));
```

Avoid extra state lock problems:

- It is acceptable for `list()` and `stats()` to take separate read locks in this phase. If a race causes slight mismatch, it is no worse than any other concurrent CLI read. Do not add a more complex combined SDK method unless tests show flakiness.

Test changes:

- Update `"list --json writes leases envelope to stdout only"`:
  - Assert `body.count === 1`.
  - Assert `body.byState.leased === 1`.
  - Assert `body.pool.max === 16`.
  - Assert `body.pool.used >= 1`.
  - Assert `body.pool.available === body.pool.max - body.pool.used`.
  - Keep existing `body.leases` assertion.

Verify:

`pnpm test -- packages/grove-cli/test/cli.test.ts` -> exit 0; list test covers aggregate fields.

### Phase 4: Add lightweight state-based suggestions

What to build:

- Create `packages/grove-cli/src/suggestions.ts`.
- Export:

```typescript
export type CliSuggestion = {
  command: string;
  reason: string;
};
```

- Implement pure functions:
  - `suggestionsForLease(lease: GroveLease): CliSuggestion[]`
  - `suggestionsForReleaseResult(result: ReleaseResult): CliSuggestion[]`
  - `suggestionsForRepairResult(result: RepairResult): CliSuggestion[]`
  - `suggestionsForList(stats: GrovePoolStats): CliSuggestion[]`
  - `suggestionsForDestroyedLease(leaseId: string): CliSuggestion[]`

Recommended mapping:

- `leased`:
  - `grove inspect --json --lease-id <id>`
  - `grove release --json --lease-id <id> --cleanup preserve`
- `preparing`:
  - `grove repair --json --lease-id <id> --action resume-acquire`
- `releasing`:
  - `grove repair --json --lease-id <id> --action resume-cleanup`
- `quarantined`:
  - `grove repair --json --lease-id <id> --action force-destroy --force`
  - optionally `grove inspect --json --lease-id <id>`
- `destroying`:
  - `grove repair --json --lease-id <id> --action force-destroy --force`

Rules:

- Suggestions must only include Grove commands.
- Suggestions must not imply that Grove owns the caller's workflow.
- Escape lease IDs safely for shell display. Minimum acceptable helper:

```typescript
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
```

But prefer avoiding quotes for valid lease IDs if the regex makes them safe. Lease IDs allow only alphanumeric, `.`, `_`, and `-`, so direct insertion is acceptable for `leaseId`.

- Add suggestions to JSON success envelopes for:
  - `acquire`
  - `inspect`
  - `release`
  - `repair`
  - `destroy`
  - `list`
- Do not add suggestions to error envelopes in this phase unless the error itself has enough structured detail. That can be a follow-up.

Test changes:

- In acquire CLI test, assert `body.suggestions` contains a release command for `cli-lease`.
- In list CLI test, assert `body.suggestions` is an array.
- In release preserve test, assert suggestions include `inspect` or `destroy` only if the lease remains preserved. If that is too brittle, assert only that the field exists and is an array.

Verify:

`pnpm test -- packages/grove-cli/test/cli.test.ts` -> exit 0; JSON stdout-only behavior remains intact.

### Phase 5: Add machine-readable command catalog

What to build:

- Create `packages/grove-cli/src/commands/commands.ts`.
- Register it from `packages/grove-cli/src/cli.ts` as `commands`.
- Output shape:

```json
{
  "ok": true,
  "commands": [
    {
      "name": "acquire",
      "description": "Acquire a lease-backed worktree from the pool",
      "usage": "grove acquire --json --lease-id <id> (--branch <name> | --ref <ref>)",
      "output": "lease"
    }
  ]
}
```

Include the existing commands:

- `acquire`
- `inspect`
- `list`
- `release`
- `repair`
- `destroy`
- `status` if Phase 6 is implemented before this, otherwise omit until Phase 6

Rules:

- Keep the catalog static and hand-written.
- Do not introspect Commander private APIs.
- Do not include package internals like `packages/grove-cli/src/exit-codes.ts` paths in the JSON output. Human docs can reference files; public CLI output should be stable.
- Add `--json` to the command. Human mode can print a compact list to stderr.

Test changes:

- Add CLI test:
  - `grove commands --json`
  - exits 0
  - stdout parses as JSON
  - `ok === true`
  - `commands` includes `acquire`, `list`, `repair`
  - stderr is empty

Verify:

`pnpm test -- packages/grove-cli/test/cli.test.ts` -> exit 0; command catalog test passes.

### Phase 6: Add `grove status --json` dashboard

What to build:

- Create `packages/grove-cli/src/commands/status.ts`.
- Register it from `packages/grove-cli/src/cli.ts`.
- Use `loadGrove({ repo: options.repo })`.
- Fetch `leases` and `stats`.
- Include repo and pool identity:

```json
{
  "ok": true,
  "repoRoot": "/absolute/repo",
  "poolDir": "/absolute/grove-dir",
  "count": 2,
  "byState": { "leased": 2 },
  "pool": { "used": 2, "max": 16, "available": 14 },
  "leases": [],
  "suggestions": []
}
```

Needed utility change:

- `loadGrove()` currently returns only `Grove`.
- Either:
  - Add `resolveGroveContext()` in `packages/grove-cli/src/utils.ts` that returns `{ grove, repoRoot, groveDir }`, or
  - Add a small `loadGroveContext()` and keep `loadGrove()` as a wrapper for existing commands.

Preferred:

```typescript
export type GroveCliContext = {
  grove: Grove;
  repoRoot: string;
  groveDir: string;
};

export async function loadGroveContext(options: { repo?: string; dir?: string }): Promise<GroveCliContext> {
  // resolve repoRoot exactly as loadGrove does today
  // call createGrove
  // return grove.poolDir as groveDir
}

export async function loadGrove(options: { repo?: string; dir?: string }): Promise<Grove> {
  return (await loadGroveContext(options)).grove;
}
```

Human mode:

- Print compact status to stderr.
- Keep stdout empty.
- Do not change `grove` with no subcommand in this plan.

Test changes:

- Add CLI test:
  - seed one lease
  - run `grove status --json -r <repo>`
  - assert `repoRoot`, `poolDir`, `count`, `byState`, `pool`, and `leases`
  - assert stderr empty

Verify:

`pnpm test -- packages/grove-cli/test/cli.test.ts` -> exit 0; status test passes.

### Phase 7: Add `skills/grove/SKILL.md`

What to build:

- Create `skills/grove/SKILL.md` in the repository.
- Use the [Agent Skills](https://agentskills.io) format.
- Follow the style of the referenced examples:
  - concise YAML frontmatter
  - direct "when to use" guidance
  - command-first workflow
  - practical tips
  - explicit scope boundaries

Recommended frontmatter:

```markdown
---
name: grove
description: "Use Grove's lease-first git worktree pool CLI for durable branch-aware worktree leases: acquire, inspect, list, release, repair, destroy, and status. Use when agents or automation need isolated reusable checkouts without cloning repeatedly."
user-invocable: false
author: Felipe Rueda (ferueda)
metadata:
  hermes:
    tags: [git, worktree, cli, leases, automation, agents]
    category: devtools
---
```

Recommended body outline:

```markdown
# Grove

Grove is a lease-first git worktree pool. It gives agents and automation durable, branch-aware checkouts keyed by `leaseId`.

Grove is not an agent runner, workflow manager, PR system, or validation framework. Use it only to manage checkout leases.

## When to use

Use Grove when a task needs an isolated reusable worktree for a repo, especially across process restarts or concurrent jobs.

## Workflow

1. Start with `grove status --json` to inspect repo, pool, capacity, active leases, and suggestions.
2. Use `grove acquire --json --lease-id <id> --branch <branch> --create-from <ref>` for branch work, or `--ref <ref>` for detached validation work.
3. Run the caller's work in `lease.path`.
4. Release explicitly with `grove release --json --lease-id <id> --cleanup preserve|reset|quarantine`.
5. If a lease is stuck, follow `suggestions` or use `grove repair --json --lease-id <id> --action <action>`.

## Commands

List the lease-first commands and prefer `--json` for agent automation.

## Tips

- Keep `GROVE_DIR` consistent across commands.
- Treat `leaseId` as the stable handle. Do not pass worktree paths to destructive commands.
- Follow `suggestions` when present.
- Use `grove commands --json` for machine-readable discovery.
```

Content requirements:

- Mention the install command exactly:

```sh
npx skills add ferueda/grove --skill grove -g
```

- Include the current primary command loop:
  - `status`
  - `acquire`
  - caller runs work in `lease.path`
  - `release`
  - `repair` when needed
- Say JSON mode is preferred for agents.
- Say Grove does not create PRs, run reviews, validate output, or own lifecycle orchestration.
- Keep the skill concise. Target about 100-180 lines, not a full README clone.

Verify:

`test -f skills/grove/SKILL.md` -> exit 0.

`pnpm lint` -> exit 0.

### Phase 8: Documentation and final gates

What to update:

- Update `README.md` CLI JSON section:
  - Mention additive `suggestions`.
  - Show `list --json` aggregate fields.
  - Document `grove commands --json` if implemented.
  - Document `grove status --json` if implemented.
  - Keep the guidance that JSON mode writes machine-readable stdout only.
- Add a quickstart subsection to the CLI documentation for the Grove Agent Skill:

````markdown
### Agent Skill Quickstart

Install the Grove skill in the [Agent Skills](https://agentskills.io) format with [`npx skills`](https://github.com/vercel-labs/skills):

```sh
npx skills add ferueda/grove --skill grove -g
```
````

- Place the quickstart near the CLI usage/JSON-mode area so agent users find it before command examples get too deep.

Do not over-document internal AXI terminology. Public docs should explain practical behavior:

- "Use `list --json` or `status --json` to inspect pool capacity."
- "Use `suggestions` for Grove-native next commands."
- "Install the Grove Agent Skill when using an agent environment that supports Agent Skills."

Verify:

`pnpm lint` -> exit 0.

`pnpm build` -> exit 0.

`pnpm typecheck` -> exit 0.

`pnpm test -- packages/grove-cli/test/cli.test.ts` -> exit 0.

`pnpm check` -> exit 0.

## Test Plan

Add or update tests in `packages/grove-cli/test/cli.test.ts`.

Use existing patterns:

- `setupRepo()` from `packages/grove/test/helpers/git-repo.ts`
- `seedLease()` from `packages/grove-cli/test/helpers/seed-lease.ts`
- `runCli()` subprocess helper using `node packages/grove-cli/dist/cli.js`
- JSON mode must assert `stderr === ""`

Required test cases:

- `errors use stable JSON envelope on stdout with mapped exit code`:
  - Update expected `LEASE_CONFLICT` details from `{}` to structured fields.
- `list --json writes leases envelope to stdout only`:
  - Preserve existing lease array checks.
  - Add `count`, `byState`, and `pool` checks.
  - Add `suggestions` array check after Phase 4.
- `acquire --json writes lease envelope to stdout only`:
  - Preserve existing `lease` checks.
  - Add `suggestions` check after Phase 4.
- New `commands --json writes machine-readable command catalog`:
  - Assert commands include `acquire`, `list`, `repair`.
- New `status --json writes pool dashboard`:
  - Seed one lease.
  - Assert `repoRoot`, `poolDir`, `count`, `byState`, `pool`, `leases`, and `suggestions`.
- New `skills/grove/SKILL.md` exists:
  - No Vitest test required.
  - Verify with `test -f skills/grove/SKILL.md`.
  - Review the frontmatter and body manually against the examples.

Optional SDK tests:

- If `Grove.stats()` logic grows beyond simple counting, add a focused SDK test under `packages/grove/test/`.
- Use real git, not mocks.

## Done Criteria

All must hold:

- [x] `LEASE_CONFLICT` JSON errors include non-empty structured `error.details`.
- [x] `grove list --json` includes `count`, `byState`, `pool.used`, `pool.max`, and `pool.available`.
- [x] Successful JSON responses for acquire/list/inspect/release/repair/destroy include additive `suggestions`.
- [x] `grove commands --json` returns a machine-readable catalog if Phase 5 is included.
- [x] `grove status --json` returns repo, pool, aggregate, lease, and suggestion data if Phase 6 is included.
- [x] `skills/grove/SKILL.md` exists and follows Agent Skills frontmatter/body conventions.
- [x] README CLI docs include the Agent Skill quickstart with `npx skills add ferueda/grove --skill grove -g`.
- [x] Existing top-level success envelope keys remain compatible: `lease`, `leases`, and `result` still exist where they existed before.
- [x] Human mode still writes prose to stderr and keeps stdout empty.
- [x] No lifecycle/workflow commands are added.
- [x] `pnpm test -- packages/grove-cli/test/cli.test.ts` exits 0.
- [x] `pnpm build` exits 0.
- [x] `pnpm typecheck` exits 0.
- [x] `pnpm lint` exits 0.
- [x] `pnpm check` exits 0 before merge.

## STOP Conditions

Stop and report back if:

- The files listed in "Current state" no longer match the excerpts closely enough to locate the same behavior.
- Adding `GroveError.details` requires changing public error codes or removing existing error subclasses.
- `Grove.stats()` cannot compute capacity without changing pool allocation semantics.
- The implementation appears to require state mutation outside transition helpers.
- A test requires mocking git to pass.
- A proposed suggestion would need to recommend non-Grove workflow actions.
- A step requires changing existing success envelope keys or defaulting to brief lease output.
- The Agent Skill content starts describing Grove as an agent runner, workflow engine, PR tool, or validation framework.
- A verification command fails twice after a focused fix attempt.

## Maintenance Notes

- Reviewers should scrutinize JSON compatibility. This plan is intentionally additive.
- `pool.used` should track slot capacity consumption, not just active lease count. If allocation rules change later, update stats with that rule.
- Suggestions are a CLI affordance, not an orchestration policy. Keep them limited to Grove commands.
- The Grove Agent Skill is documentation and onboarding for agent environments. Keep it synchronized with CLI command names and JSON fields.
- If future versions introduce `--view summary|full`, that should be a separate versioned output-shape plan.
- If `repair` envelopes are unified later, treat it as a compatibility-sensitive follow-up.
- If `GROVE_MAX_TREES` or other CLI config env vars are added later, update `status --json` and README together.

