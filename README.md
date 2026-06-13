# Grove

> A fast, secure pool of reusable git worktrees with durable branch-aware leases

Grove is a TypeScript SDK and CLI for managing pools of Git worktrees. Instead of re-cloning repositories or suffering through long `git fetch` operations for concurrent jobs, Grove maintains a pool of fast, clean, and isolated worktrees tied to stable `leaseId` reservations.

Orchestrators acquire a lease-backed checkout, run work across process restarts, and explicitly release, repair, or destroy when done. Commits and dirty state survive until you choose a cleanup policy (`preserve`, `reset`, or `quarantine`).

## Features

- **Durable leases:** Branch-aware and detached-ref acquisition with idempotent re-acquire, persisted state across process restarts, and explicit cleanup policies.
- **Blazing fast reuse:** Reset cleanup uses `git clean -fd` by default (not `-xfd`), so ignored caches like `node_modules` survive across resets.
- **Process safety:** PID reservations and filesystem scans block destructive cleanup unless `force: true`. Unverified safety is reported as `processSafety: "unverified"`.
- **Crash recovery:** Write-ahead state for release and destroy; explicit `repair()` actions resume interrupted operations.
- **State & locking:** Cross-platform file locking handles concurrent acquires across terminals and CI jobs.
- **Scriptable CLI:** Lease-first commands with stable `--json` envelopes.

---

## The Grove CLI

### Installation

```bash
pnpm add -g @ferueda/grove-cli
# Or using npm
npm install -g @ferueda/grove-cli
```

### Usage

Run Grove commands from inside any Git repository. Grove detects the repository root unless overridden by `--repo` or `GROVE_REPO_ROOT`. Grove creates the pool in `~/.grove/<hash>/` unless overridden by `GROVE_DIR`.

| Variable | Purpose |
|----------|---------|
| `GROVE_REPO_ROOT` | Override repository root detection |
| `GROVE_DIR` | Override pool directory (state + worktrees) |

`leaseId` format: `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$`

### Commands

#### Acquire a lease

```bash
grove acquire --json \
  --lease-id job_abc123 \
  --branch agent/job_abc123 \
  --create-from origin/main

grove acquire --json \
  --lease-id existing_job \
  --branch agent/existing_job \
  --create-from origin/main \
  --reuse-existing-branch

grove acquire --json \
  --lease-id validation_abc123 \
  --ref origin/main
```

#### Inspect and list

```bash
grove inspect --json --lease-id job_abc123
grove list --json
```

#### Release a lease

```bash
grove release --json --lease-id job_abc123 --cleanup preserve
grove release --json --lease-id job_abc123 --cleanup reset --reset-to origin/main
grove release --json --lease-id job_abc123 --cleanup quarantine
grove release --json --lease-id job_abc123 --cleanup reset --force
```

#### Repair a stuck lease

```bash
grove repair --json --lease-id job_abc123 --action quarantine
grove repair --json --lease-id job_abc123 --action resume-acquire
grove repair --json --lease-id job_abc123 --action resume-cleanup
grove repair --json --lease-id job_abc123 --action force-destroy --force
```

#### Destroy a lease

```bash
grove destroy --json --lease-id job_abc123
grove destroy --json --lease-id job_abc123 --force
```

Discovery and dashboard:

```bash
grove status --json
grove commands --json
```

### Agent Skill Quickstart

Install the Grove skill in the [Agent Skills](https://agentskills.io) format with [`npx skills`](https://github.com/vercel/labs/skills):

```sh
npx skills add ferueda/grove --skill grove -g
```

### JSON mode

With `--json`, stdout is machine-readable only. Human messages go to stderr.

Success responses may include additive fields beyond the primary payload:

- `suggestions` — advisory next Grove commands (`command` + `reason`)
- `count`, `byState`, `pool` — on `list --json` and `status --json`

Success examples:

```json
{ "ok": true, "lease": {}, "suggestions": [{ "command": "grove release --json --lease-id job_abc123 --cleanup preserve", "reason": "..." }] }
```

```json
{ "ok": true, "result": { "status": "preserved", "leaseId": "job_abc123" } }
```

```json
{ "ok": true, "leases": [], "count": 2, "byState": { "leased": 1, "quarantined": 1 }, "pool": { "used": 2, "max": 16, "available": 14 } }
```

```json
{ "ok": true, "repoRoot": "/path/to/repo", "poolDir": "/path/to/pool", "count": 1, "byState": { "leased": 1 }, "pool": { "used": 1, "max": 16, "available": 15 }, "leases": [] }
```

```json
{ "ok": true, "commands": [{ "name": "acquire", "description": "...", "usage": "...", "output": "lease" }] }
```

Error example:

```json
{
  "ok": false,
  "error": {
    "code": "LEASE_CONFLICT",
    "message": "Lease job_abc123 targets a different branch",
    "details": {
      "leaseId": "job_abc123",
      "existingState": "leased",
      "existingBranch": "branch-a",
      "requestedBranch": "branch-b"
    }
  }
}
```

Exit codes map to error categories (e.g. `LEASE_CONFLICT` → 3, `POOL_EXHAUSTED` → 4). See `packages/grove-cli/src/exit-codes.ts`.

---

## The Programmatic SDK

### Installation

```bash
pnpm add @ferueda/grove
```

Requires Node.js **>= 24**.

### Quick start

```typescript
import { createGrove, isReleaseResult, isRepairResult } from "@ferueda/grove";

const grove = await createGrove({
  repoRoot: "/absolute/path/to/my-repo",
  maxTrees: 8,
  hooks: {
    postAcquire: ["pnpm install"],
  },
});

const lease = await grove.acquire({
  leaseId: "job_abc123",
  ownerId: "my-orchestrator",
  mode: "branch",
  branch: "agent/job_abc123",
  createBranch: { from: "origin/main", ifExists: "fail" },
  ifLeased: "return-existing",
});

console.log(lease.path, lease.branch, lease.currentHeadSha);

await grove.release(lease.leaseId, { cleanup: "preserve" });

const result = await grove.release(lease.leaseId, {
  cleanup: "reset",
  resetTo: "origin/main",
});
if (isReleaseResult(result) && result.status === "released") {
  console.log("slot returned to pool");
}
```

### API reference

#### `createGrove(config)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `repoRoot` | `string` | required | Absolute path to the main Git repository |
| `groveRoot` | `string` | `~/.grove/` | Parent directory for pool state and checkouts |
| `groveDir` | `string` | — | Full absolute pool path (overrides `groveRoot`) |
| `maxTrees` | `number` | `16` | Maximum pool slots |
| `fetchOnAcquire` | `boolean` | `true` | Run `git fetch origin` before acquire |
| `hookTimeoutMs` | `number` | — | Max runtime per hook command |
| `onHookFailure` | `"ignore" \| "fail"` | `"ignore"` | Whether hook failures abort the operation |
| `hooks` | object | — | See [Lifecycle hooks](#lifecycle-hooks) |

#### `Grove`

| Method | Returns | Description |
|--------|---------|-------------|
| `acquire(options)` | `Promise<GroveLease>` | Acquire or re-acquire a durable lease |
| `inspect(leaseId)` | `Promise<GroveLease \| null>` | Get lease metadata; refreshes `currentHeadSha` |
| `list(options?)` | `Promise<readonly GroveLease[]>` | List active leases |
| `release(leaseId, options)` | `Promise<ReleaseResult>` | Apply a cleanup policy |
| `destroy(leaseId, options?)` | `Promise<void>` | Remove lease worktree and state |
| `repair(options)` | `Promise<GroveLease \| ReleaseResult \| RepairResult>` | Recover stuck leases |

Destructive operations accept **`leaseId` only**, not worktree paths.

**Acquire options** (`AcquireLeaseOptions`):

```typescript
type AcquireLeaseOptions = {
  leaseId: string;
  ownerId?: string;
  ifLeased?: "return-existing" | "fail";
  fetchOnAcquire?: boolean;
  metadata?: Record<string, string>;
} & (
  | {
      mode: "branch";
      branch: string;
      createBranch?: { from: string; ifExists: "reuse" | "fail" };
    }
  | { mode: "detached"; ref: string }
);
```

**Release options** (`ReleaseLeaseOptions`):

```typescript
type ReleaseLeaseOptions =
  | { cleanup: "preserve" }
  | { cleanup: "reset"; resetTo?: string; force?: boolean; cleanIgnored?: boolean }
  | { cleanup: "quarantine" };
```

**Repair options** (`RepairLeaseOptions`):

```typescript
{
  leaseId: string;
  action: "quarantine" | "resume-acquire" | "resume-cleanup" | "force-destroy";
  force?: boolean;
}
```

**Lease object** (`GroveLease`):

```typescript
interface GroveLease {
  leaseId: string;
  ownerId?: string;
  slotName: string;
  path: string;
  repoRoot: string;
  branch?: string;
  baseRef?: string;
  baseSha?: string;
  target?: GroveLeaseTarget;
  acquiredHeadSha: string;
  currentHeadSha: string;
  state: "preparing" | "leased" | "releasing" | "destroying" | "quarantined";
  pendingAcquire?: PendingAcquire;
  pendingCleanup?: GroveCleanupIntent;
  processSafety?: "verified" | "unverified";
  diagnostics?: GroveLeaseDiagnostics;
  metadata?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}
```

`branch`, `baseRef`, and `baseSha` are convenience projections from `target` when present.

#### Lease states

| State | Meaning |
|-------|---------|
| `preparing` | Checkout in progress; use `repair({ action: "resume-acquire" })` after failure |
| `leased` | Active reservation |
| `releasing` | Cleanup in progress; use `repair({ action: "resume-cleanup" })` after failure |
| `destroying` | Worktree removal in progress; idempotent `destroy()` resumes |
| `quarantined` | Blocked; requires `repair()` or `destroy()` |

Re-acquiring the same `leaseId` with a compatible branch/ref is idempotent. Conflicting targets throw `LEASE_CONFLICT`.

Branch creation defaults should be fail-first for new work. Use `ifExists: "reuse"` only when intentionally resuming or attaching to an existing local branch. `repair({ action: "resume-acquire" })` may reuse a branch created by the interrupted acquire so recovery can complete.

### Lifecycle hooks

Configure shell commands in `createGrove({ hooks })`. Hook cwd is the worktree path.

| Hook | When |
|------|------|
| `postCreate` | After a new physical slot is created |
| `postAcquire` | After branch/ref checkout |
| `preRelease` | Before lease cleanup |
| `postRelease` | After lease cleanup |
| `preDestroy` | Before worktree removal |

Lease hooks receive: `GROVE_LEASE_ID`, `GROVE_SLOT_NAME`, `GROVE_BRANCH`, `GROVE_REPO_ROOT`, `GROVE_WORKTREE_PATH`.

Set `onHookFailure: "fail"` to throw `HOOK_FAILED` on hook errors.

### Error model

All Grove errors extend `GroveError` with a stable `.code` property. The CLI maps most codes to exit categories via `packages/grove-cli/src/exit-codes.ts`; unmapped codes exit `1`.

| Code | When | CLI exit |
|------|------|----------|
| `INVALID_INPUT` | Invalid `leaseId` or options at API boundary | 2 |
| `LEASE_CONFLICT` | Re-acquire with incompatible branch/ref | 3 |
| `LEASE_ALREADY_EXISTS` | Acquire with `ifLeased: "fail"` on existing lease | 3 |
| `GROVE_EXHAUSTED` | No pool capacity (legacy alias) | 4 |
| `POOL_EXHAUSTED` | Pool at `maxTrees` with no available slots | 4 |
| `GIT_NOT_FOUND` | `git` binary not found | 5 |
| `GIT_COMMAND_FAILED` | Git subprocess failed | 5 |
| `LOCK_FAILED` | Could not acquire state file lock | 6 |
| `UNSAFE_CLEANUP` | Destructive op blocked by processes | 7 |
| `PROCESS_SAFETY_UNVERIFIED` | Destructive op with unverified process safety | 7 |
| `WORKTREE_IN_USE` | Legacy worktree-in-use guard | 7 |
| `LEASE_NOT_FOUND` | Unknown `leaseId` | 8 |
| `WORKTREE_NOT_MANAGED` | Legacy path not in pool | 8 |
| `LEASE_QUARANTINED` | Lease is quarantined | 9 |
| `LEASE_BUSY` | Lease in transient state | 9 |
| `ACQUIRE_IN_PROGRESS` | Acquire still preparing | 9 |
| `REPAIR_NOT_AVAILABLE` | Repair action missing required intent | 10 |
| `INVALID_TRANSITION` | Illegal lease/slot state transition | 10 |
| `INVALID_GROVE_STATE` | Corrupt `grove-state.json` | 11 |
| `PATH_OUTSIDE_POOL` | Destructive target outside pool boundary | 12 |
| `BRANCH_EXISTS` | Branch create failed because branch exists | 13 |
| `BRANCH_NOT_FOUND` | Requested branch does not exist | 13 |
| `REF_NOT_FOUND` | Requested ref does not resolve | 13 |
| `HOOK_FAILED` | Hook failed with `onHookFailure: "fail"` | 14 |
| `WORKTREE_DESTROYING` | Legacy destroying guard | 1 |
| `BRANCH_DELETE_FAILED` | Branch deletion failed during destroy | 1 |

```typescript
import { LeaseConflictError } from "@ferueda/grove";

try {
  await grove.acquire({ leaseId: "job_1", mode: "branch", branch: "other" });
} catch (err) {
  if (err instanceof LeaseConflictError) {
    console.error(err.code); // "LEASE_CONFLICT"
  }
}
```

---

## Related docs

- Product vision: [`VISION.md`](VISION.md)
- Contributor guide: [`AGENTS.md`](AGENTS.md)
