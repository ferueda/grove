# Grove

> A fast, secure pool of reusable git worktrees

Grove is a TypeScript SDK and CLI for managing pools of Git worktrees. Instead of re-cloning repositories or suffering through long `git fetch` operations for concurrent jobs, Grove maintains a pool of fast, clean, and isolated worktrees.

Grove supports two allocation modes:

- **Ephemeral pool** (default): instantly acquire a detached-HEAD checkout, do work, reset and return the slot to the pool. Ideal for CI jobs and one-off clean checkouts.
- **Lease mode** (v0.3+): acquire a durable, branch-aware reservation tied to a stable `leaseId`. Commits and dirty state survive until you explicitly release, reset, quarantine, or destroy the lease. Ideal for long-running orchestrators and multi-stage agent jobs.

When your application, agent, or shell needs a clean workspace, it acquires a worktree from the pool. When the job is finished, you either reset and release (ephemeral) or apply a cleanup policy (lease).

## Features

- **Blazing Fast Acquisition:** Instantly get a clean checkout. `node_modules` survive across resets because Grove uses `git clean -fd` (not `-xfd`), avoiding slow reinstalls.
- **Auto-Syncing:** Ephemeral slots automatically run `git fetch` and reset to the default branch before reuse.
- **Durable Leases:** Branch-aware acquisition with idempotent re-acquire, persisted state across process restarts, and explicit cleanup policies (`preserve`, `reset`, `quarantine`).
- **Process Detection & Quarantine:** Prevents claiming or destructively cleaning worktrees that are in use by active OS processes (via `lsof` on Unix). When process scanning is unavailable, destructive operations require `force: true` and report `processSafety: "unverified"`.
- **State & Locking:** Cross-platform file locking safely handles concurrent acquisitions across terminals and parallel CI jobs.
- **Scriptable CLI:** All lease commands support `--json` for machine-readable output.

---

## The Grove CLI

Grove ships with a CLI for daily development and orchestrator scripting.

### Installation

```bash
pnpm add -g @ferueda/grove-cli
# Or using npm
npm install -g @ferueda/grove-cli
```

### Usage

Run Grove commands from inside any Git repository. Grove detects the repository and creates the pool in `~/.grove/<hash>/` unless overridden by `GROVE_DIR` or `--repo`.

Environment variables:

| Variable | Purpose |
|----------|---------|
| `GROVE_REPO_ROOT` | Override repository root detection |
| `GROVE_DIR` | Override pool directory (state + worktrees) |

### Ephemeral Pool Commands

#### Acquiring a Worktree

```bash
# Interactive: drops you into a subshell; auto-releases on exit
grove acquire --shell

# Programmatic: prints the path to stdout
grove acquire

# JSON output
grove acquire --json
```

Combine programmatic mode with `cd`:

```bash
cd $(grove acquire)
```

#### Releasing a Worktree

Reset to the default branch and return the slot to the pool:

```bash
grove release
```

If you run `release` while physically inside the worktree, Grove quarantines it (`you're here`) until you `cd` out.

#### Checking Pool Status

```bash
grove status
grove status --json
```

Shows available, in-use, dirty, and quarantined ephemeral slots with active process PIDs.

#### Cleaning Up

```bash
grove destroy 1
grove destroy-all
grove destroy-all --force --json
```

### Lease Mode Commands

Lease commands require a stable `--lease` ID (format: `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$`).

#### Acquire a Lease

```bash
# Branch lease: create branch from origin/main if missing
grove acquire --json \
  --lease wu_abc123 \
  --owner my-orchestrator \
  --branch jobs/wu_abc123 \
  --create-branch-from origin/main

# Detached ref lease
grove acquire --json \
  --lease read_job_1 \
  --ref origin/main

# Fail if branch already exists (default: reuse)
grove acquire --lease wu_abc123 \
  --branch feature/x \
  --create-branch-from main \
  --fail-if-exists
```

#### Inspect a Lease

```bash
grove inspect wu_abc123 --json
grove inspect /path/to/worktree --json
```

#### List Leases

```bash
grove status --leases
grove status --leases --json
```

#### Release a Lease

```bash
# Preserve commits and branch; clear active owner only (lease stays leased)
grove release wu_abc123 --cleanup preserve --json

# Reset to origin/main and return slot to pool
grove release wu_abc123 --cleanup reset --reset-to origin/main --json

# Mark unusable until repair
grove release wu_abc123 --cleanup quarantine --json

# Force reset when processes are present
grove release wu_abc123 --cleanup reset --force --json
```

#### Destroy a Lease

Removes the worktree slot from disk and pool state. Does **not** delete the branch unless `--delete-branch` is set and the branch matches a configured safe-delete prefix (SDK config only).

```bash
grove destroy wu_abc123 --json
grove destroy wu_abc123 --delete-branch --force --json
```

#### Repair a Stuck Lease

```bash
grove repair wu_abc123 --action quarantine --json
grove repair wu_abc123 --action resume-cleanup --json
grove repair wu_abc123 --action force-destroy --force --json
```

### CLI JSON Mode

With `--json`, Grove writes machine-readable JSON to **stdout** only. Human messages go to stderr. Errors emit `{ "error": "...", "code": "LEASE_CONFLICT" }` to stdout and exit with code 1.

---

## The Programmatic SDK

Install the SDK for AI agents, CI runners, or automation scripts.

### Installation

```bash
pnpm add @ferueda/grove
```

Requires Node.js **>= 24**.

### Quick Start (Ephemeral Pool)

```typescript
import { createGrove } from "@ferueda/grove";

const grove = await createGrove({
  repoRoot: "/absolute/path/to/my-repo",
  maxTrees: 8,
  hooks: {
    postCreate: ["pnpm install"],
  },
});

const slot = await grove.acquire();
console.log(`Worktree acquired: ${slot.path} (ID: ${slot.name})`);

// Do work inside slot.path...

await grove.release(slot.path);
```

### Quick Start (Lease Mode)

```typescript
import { createGrove } from "@ferueda/grove";

const grove = await createGrove({
  repoRoot: "/absolute/path/to/my-repo",
  safeDeleteBranchPrefixes: ["jobs/"],
  hooks: {
    postAcquire: ["pnpm install"],
  },
});

const lease = await grove.acquire({
  leaseId: "wu_abc123",
  ownerId: "my-orchestrator",
  mode: "branch",
  branch: "jobs/wu_abc123",
  createBranch: { from: "origin/main", ifExists: "reuse" },
  ifLeased: "return-existing",
});

console.log(lease.path, lease.branch, lease.currentHeadSha);

// Run agent stages in lease.path; commits persist...

await grove.release(lease.leaseId, { cleanup: "preserve" });

// Later: reset slot back to pool
await grove.release(lease.leaseId, {
  cleanup: "reset",
  resetTo: "origin/main",
});
```

### API Reference

#### `createGrove(config)`

Initializes a `Grove` pool manager.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `repoRoot` | `string` | required | Absolute path to the main Git repository |
| `groveRoot` | `string` | `~/.grove/` | Parent directory for pool state and checkouts |
| `groveDir` | `string` | — | Full absolute pool path (overrides `groveRoot`) |
| `maxTrees` | `number` | `16` | Maximum pool slots |
| `fetchOnAcquire` | `boolean` | `true` | Run `git fetch origin` before acquire |
| `safeDeleteBranchPrefixes` | `string[]` | `[]` | Allowed branch prefixes for `destroy({ deleteBranch: true })` |
| `hookTimeoutMs` | `number` | — | Max runtime per hook command |
| `onHookFailure` | `"ignore" \| "fail"` | `"ignore"` | Whether hook failures abort the operation |
| `hooks` | object | — | See [Lifecycle Hooks](#lifecycle-hooks) |

#### `Grove` — Ephemeral Pool

| Method | Returns | Description |
|--------|---------|-------------|
| `acquire()` | `Promise<AcquiredSlot>` | Allocate a clean detached-HEAD slot |
| `release(path)` | `Promise<void>` | Reset slot to default branch and return to pool |
| `list()` | `Promise<WorktreeStatus[]>` | List ephemeral slots (excludes leased slots) |
| `destroy(path, options?)` | `Promise<void>` | Remove a slot from disk and state |
| `destroyAll(options?)` | `Promise<void>` | Remove all slots |

`AcquiredSlot`: `{ path: string; name: string }`

`WorktreeStatus`: `{ name, path, status, processes }` where `status` is `"available" | "dirty" | "in-use" | "you're here"`.

#### `Grove` — Lease Mode

| Method | Returns | Description |
|--------|---------|-------------|
| `acquire(options)` | `Promise<GroveLease>` | Acquire or re-acquire a durable lease |
| `inspect(leaseIdOrPath)` | `Promise<GroveLease \| null>` | Get lease metadata; refreshes `currentHeadSha` |
| `listLeases()` | `Promise<GroveLease[]>` | List all active leases |
| `release(leaseIdOrPath, options)` | `Promise<GroveLease>` | Apply a cleanup policy |
| `destroy(leaseIdOrPath, options?)` | `Promise<void>` | Remove worktree slot (optional branch delete) |
| `repair(options)` | `Promise<GroveLease \| void>` | Recover stuck leases |

**Acquire options** (`AcquireLeaseOptions`):

```typescript
type AcquireLeaseOptions = {
  leaseId: string;
  ownerId?: string;
  ifLeased?: "return-existing" | "fail"; // default: return-existing
  fetchOnAcquire?: boolean;
  metadata?: Record<string, string>;
} & (
  | {
      mode: "branch";
      branch: string;
      createBranch?: { from: string; ifExists?: "reuse" | "fail" };
    }
  | { mode: "detached"; ref: string }
);
```

**Release options** (`ReleaseLeaseOptions`):

```typescript
type ReleaseLeaseOptions =
  | { cleanup: "preserve" }
  | { cleanup: "reset"; resetTo?: string; force?: boolean }
  | { cleanup: "quarantine" };
```

**Destroy options** (`DestroyLeaseOptions`):

```typescript
{ force?: boolean; deleteBranch?: boolean }
```

**Repair options** (`RepairLeaseOptions`):

```typescript
{
  leaseId: string;
  action: "quarantine" | "resume-cleanup" | "force-destroy";
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
  acquiredHeadSha: string;
  currentHeadSha: string;
  state: "leased" | "available" | "releasing" | "destroying" | "quarantined";
  pendingCleanup?: GroveCleanupIntent;
  processSafety?: "verified" | "unverified";
  createdAt: string;
  updatedAt: string;
}
```

#### Lease States

| State | Meaning |
|-------|---------|
| `leased` | Active reservation; slot must not be reused |
| `available` | No durable lease (ephemeral slot) |
| `releasing` | Cleanup in progress |
| `destroying` | Worktree removal in progress |
| `quarantined` | Unsafe to reuse; requires `repair()` |

Re-acquiring the same `leaseId` with a compatible branch/ref is idempotent and returns the existing lease. Conflicting targets throw `LEASE_CONFLICT`.

### Lifecycle Hooks

Configure shell commands in `createGrove({ hooks })`. Hook cwd is the worktree path.

| Hook | When |
|------|------|
| `postCreate` | After a new physical slot is created |
| `postAcquire` | After branch/ref checkout in lease mode |
| `preRelease` | Before lease cleanup |
| `postRelease` | After lease cleanup |
| `preDestroy` | Before worktree removal |

Lease hooks receive environment variables:

- `GROVE_LEASE_ID`
- `GROVE_SLOT_NAME`
- `GROVE_BRANCH` (when applicable)
- `GROVE_REPO_ROOT`
- `GROVE_WORKTREE_PATH`

Set `onHookFailure: "fail"` to throw `HOOK_FAILED` on hook errors. Use `hookTimeoutMs` to cap hook runtime.

### Error Model

All Grove errors extend `GroveError` with a stable `.code` property.

| Code | When |
|------|------|
| `GROVE_EXHAUSTED` | Pool at `maxTrees` with no available slots |
| `WORKTREE_DESTROYING` | Slot is mid-destruction |
| `WORKTREE_NOT_MANAGED` | Path not in pool |
| `WORKTREE_IN_USE` | Active owner or processes |
| `GIT_NOT_FOUND` | `git` binary missing |
| `GIT_COMMAND_FAILED` | Git subprocess failed (`.stderr` available) |
| `INVALID_GROVE_STATE` | Corrupt or invalid `grove-state.json` |
| `LOCK_FAILED` | Could not acquire state file lock |
| `LEASE_NOT_FOUND` | Lease ID or path not found |
| `LEASE_CONFLICT` | Re-acquire with incompatible branch/ref |
| `LEASE_ALREADY_EXISTS` | Acquire with `ifLeased: "fail"` on existing lease |
| `LEASE_QUARANTINED` | Lease is quarantined or path missing |
| `UNSAFE_CLEANUP` | Destructive op blocked by processes or unverified safety |
| `BRANCH_EXISTS` | Branch creation with `ifExists: "fail"` |
| `BRANCH_NOT_FOUND` | Referenced branch missing |
| `REF_NOT_FOUND` | Referenced ref/SHA missing |
| `PATH_OUTSIDE_POOL` | Destructive op target outside pool boundary |
| `BRANCH_DELETE_FAILED` | Branch deletion failed during destroy |
| `HOOK_FAILED` | Hook failed with `onHookFailure: "fail"` |

```typescript
import { LeaseConflictError } from "@ferueda/grove";

try {
  await grove.acquire({ leaseId: "wu_1", mode: "branch", branch: "other" });
} catch (err) {
  if (err instanceof LeaseConflictError) {
    console.error(err.code); // "LEASE_CONFLICT"
  }
}
```

---

## Related Docs

- Product vision: [`VISION.md`](VISION.md)
- Agent/contributor guide: [`AGENTS.md`](AGENTS.md)
