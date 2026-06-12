# Grove V1 Lease-First Implementation Plan

Status: draft.

Source: GitHub issue #29 proposal and follow-up review discussion on 2026-06-11.

## Summary

Grove v1 should become a durable, branch-aware worktree leasing system.

The core change is to make `leaseId` the primary public identifier. Grove should
own safe worktree leasing, state locking, branch checkout, destructive cleanup,
process safety, and crash recovery. Orchestrators should own workflow policy,
validation, pull request creation, event history, and final lifecycle decisions.

This plan describes the breaking lease-first implementation path. It intentionally
removes the legacy no-argument `acquire()` and path-based `release()` model from
the v1 public API.

## Core Reliability Contract

Every mutating operation must follow the same state-machine pattern:

1. Acquire Grove state lock.
2. Validate the requested transition.
3. Persist intent before Git or filesystem side effects.
4. Release the lock.
5. Perform Git or filesystem side effects.
6. Reacquire the lock.
7. Finalize state, or quarantine with actionable repair metadata.

This keeps crashes recoverable. Grove should never leave state that says a lease
is healthy when checkout, cleanup, or destruction did not finish.

No destructive operation should run unless Grove can prove the target is a
managed worktree inside the pool and no active processes are present. Destructive
operations must perform a fresh process scan at the time of reset or destroy. Any
persisted process safety value is diagnostic only; it is never permission to
reuse, reset, or destroy a worktree. If process safety is unavailable or
unverified, destructive operations must require `force: true`.

## Core Invariants

- Public destructive operations operate on `leaseId`, not paths.
- Physical slot paths are internal implementation details.
- A lease may survive owner process exit.
- Active process ownership and durable lease ownership are separate concepts.
- Moving refs such as `origin/main` must not silently reinterpret an existing
  lease.
- Reset cleanup preserves ignored cache files by default.
- Branch deletion is never default.
- Repair is explicit. No TTL-based auto-destruction.
- Invalid state fails loudly with stable typed errors.

## Data Model

Separate physical slots from durable leases internally.

```ts
interface GroveSlot {
  slotName: string;
  path: string;
  state: "available" | "leased" | "quarantined" | "destroying";
  lastProcessSafetyCheck?: ProcessSafetyDiagnostic;
  createdAt: string;
  updatedAt: string;
}
```

Persist a normalized target on every lease. This becomes the compatibility
contract for idempotent reacquire.

```ts
interface ProcessSafetyDiagnostic {
  status: "verified" | "unverified";
  checkedAt: string;
  processes?: readonly ProcessInfo[];
}

type GroveLeaseTarget = BranchLeaseTarget | DetachedLeaseTarget;

interface BranchLeaseTarget {
  mode: "branch";
  branch: string;
  requestedRef: string;
  resolvedRefSha: string;
  branchHeadShaAtAcquire: string;
  createFromRef?: string;
  createFromSha?: string;
}

interface DetachedLeaseTarget {
  mode: "detached";
  requestedRef: string;
  resolvedRefSha: string;
}
```

`requestedRef` is the caller-provided branch or detached ref. `resolvedRefSha` is
the SHA Grove resolved during the first successful acquire. Branch leases also
store the branch HEAD observed at acquire time. Reacquire compares these stored
values. It must not reinterpret an existing lease because a moving ref changed.

Acquire needs a persisted intent, just like release cleanup. This closes the
crash window between slot reservation and successful checkout.

```ts
interface PendingAcquire {
  target: GroveLeaseTarget;
  startedAt: string;
}
```

Lease state should include a `preparing` state for incomplete acquire operations.

```ts
interface GroveLease {
  leaseId: string;
  ownerId?: string;
  slotName: string;
  path: string;
  repoRoot: string;
  target: GroveLeaseTarget;
  acquiredHeadSha: string;
  currentHeadSha: string;
  state: "preparing" | "leased" | "releasing" | "destroying" | "quarantined";
  pendingAcquire?: PendingAcquire;
  pendingCleanup?: GroveCleanupIntent;
  diagnostics?: {
    missingPath?: boolean;
    lastProcessSafetyCheck?: ProcessSafetyDiagnostic;
  };
  metadata?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}
```

## SDK Surface

V1 should expose only lease-first operations.

```ts
type AcquireMode =
  | {
      mode: "branch";
      branch: string;
      createBranch?: {
        from: string;
        ifExists?: "reuse" | "fail";
      };
    }
  | {
      mode: "detached";
      ref: string;
    };

type AcquireLeaseOptions = AcquireMode & {
  leaseId: string;
  ownerId?: string;
  ifLeased?: "return-existing" | "fail";
  fetchOnAcquire?: boolean;
  metadata?: Record<string, string>;
};
```

```ts
type GroveCleanupIntent =
  | { cleanup: "preserve" }
  | {
      cleanup: "reset";
      resetTo: string;
      force?: boolean;
      cleanIgnored?: boolean;
    }
  | { cleanup: "quarantine" };

type ReleaseLeaseOptions = GroveCleanupIntent;
```

`release()` should return a result union. Returning `GroveLease` for reset is
semantically wrong because reset clears the durable lease.

```ts
type ReleaseResult =
  | { status: "preserved"; leaseId: string; lease: GroveLease }
  | { status: "released"; leaseId: string; slotName: string; path: string }
  | { status: "quarantined"; leaseId: string; lease: GroveLease };
```

```ts
interface DestroyLeaseOptions {
  force?: boolean;
}

interface RepairLeaseOptions {
  leaseId: string;
  action: "quarantine" | "resume-acquire" | "resume-cleanup" | "force-destroy";
  force?: boolean;
}

interface Grove {
  acquire(options: AcquireLeaseOptions): Promise<GroveLease>;
  inspect(leaseId: string): Promise<GroveLease | null>;
  list(options?: { includeProcesses?: boolean }): Promise<readonly GroveLease[]>;
  release(leaseId: string, options: ReleaseLeaseOptions): Promise<ReleaseResult>;
  destroy(leaseId: string, options?: DestroyLeaseOptions): Promise<void>;
  repair(options: RepairLeaseOptions): Promise<GroveLease | void>;
}
```

## State Machines

### Slot State

Slots represent reusable physical directories.

```text
available -> leased
available -> destroying
available -> quarantined
leased -> available
leased -> destroying
leased -> quarantined
quarantined -> destroying
quarantined -> available only through explicit repair
destroying -> removed from state
```

### Lease State

Leases represent durable external work units.

```text
preparing -> leased
preparing -> quarantined
leased -> releasing
leased -> destroying
leased -> quarantined
releasing -> leased       preserve completed
releasing -> removed      reset completed
releasing -> quarantined  cleanup failed or quarantine requested
destroying -> removed
destroying -> quarantined if destruction fails after state was persisted
quarantined -> destroying
quarantined -> preparing only through resume-acquire
quarantined -> releasing only through resume-cleanup
```

Invalid transitions should throw `INVALID_TRANSITION`. Repair transitions have
extra preconditions: `resume-acquire` requires `pendingAcquire`, and
`resume-cleanup` requires `pendingCleanup`. If the required intent is missing,
throw `REPAIR_NOT_AVAILABLE`.

### State Classification

Callers and implementers should treat lease states differently based on whether
they are stable or transient.

| Lease state | Kind | Caller behavior |
| --- | --- | --- |
| `preparing` | transient | Return `ACQUIRE_IN_PROGRESS` on reacquire unless `repair({ action: "resume-acquire" })` is used. Block release and normal destroy. |
| `leased` | stable | Normal usable lease state. Allows release, destroy, quarantine repair, inspect, and list. |
| `releasing` | transient | Return `LEASE_BUSY` for acquire/release/destroy except `repair({ action: "resume-cleanup" })`. |
| `destroying` | transient | Return `LEASE_BUSY` for acquire/release. A repeated destroy may resume if the persisted destroy intent is still present. |
| `quarantined` | stable blocked | Return `LEASE_QUARANTINED` for acquire/release. Allows explicit repair or destroy. |
| removed | terminal | `inspect()` returns `null`; mutators throw `LEASE_NOT_FOUND`. |

Slot states are also classified:

| Slot state | Kind | Meaning |
| --- | --- | --- |
| `available` | stable | Slot has no durable lease and may be allocated. |
| `leased` | stable or transient-reserved | Slot is reserved by a lease, including `preparing` and `releasing`. |
| `quarantined` | stable blocked | Slot must not be reused until explicit repair or destroy. |
| `destroying` | transient | Slot is being removed and must not be allocated. |
| removed | terminal | Slot record no longer exists. |

### Transition Authority

Implementation should avoid inline `lease.state = ...` or `slot.state = ...`
assignments in mutators. Add a small transition module, for example
`src/transitions.ts`, and make it the only place that changes slot or lease
state.

Keep this simple. Grove does not need an XState-style runtime or interpreter.
Use pure functions and explicit events:

```ts
type LeaseEvent =
  | { type: "ACQUIRE_START"; pendingAcquire: PendingAcquire }
  | { type: "ACQUIRE_COMPLETE"; target: GroveLeaseTarget; headSha: string }
  | { type: "ACQUIRE_FAILED"; reason: string }
  | { type: "RELEASE_START"; cleanup: GroveCleanupIntent }
  | { type: "RELEASE_PRESERVE_COMPLETE" }
  | { type: "RELEASE_RESET_COMPLETE" }
  | { type: "RELEASE_FAILED"; reason: string }
  | { type: "QUARANTINE"; reason: string }
  | { type: "DESTROY_START" }
  | { type: "DESTROY_COMPLETE" }
  | { type: "DESTROY_FAILED"; reason: string }
  | { type: "REPAIR_RESUME_ACQUIRE" }
  | { type: "REPAIR_RESUME_CLEANUP" };

type SlotEvent =
  | { type: "RESERVE_FOR_LEASE" }
  | { type: "RELEASE_TO_POOL" }
  | { type: "QUARANTINE" }
  | { type: "DESTROY_START" }
  | { type: "DESTROY_COMPLETE" };
```

Suggested helpers:

```ts
function transitionLease(lease: GroveLease, event: LeaseEvent): GroveLease | null;
function transitionSlot(slot: GroveSlot, event: SlotEvent): GroveSlot | null;
function assertJointInvariants(state: GroveState): void;
```

`null` represents terminal removal. The transition helpers should enforce
`INVALID_TRANSITION`, `ACQUIRE_IN_PROGRESS`, `LEASE_BUSY`, `LEASE_QUARANTINED`,
and `REPAIR_NOT_AVAILABLE` where appropriate. Operations such as `acquire()`,
`release()`, and `destroy()` should orchestrate locks and side effects, but they
should not hand-edit state.

### Joint Slot-Lease Invariants

Slot and lease states must be validated together. The top-level state schema or
state loader should enforce this matrix.

| Lease state | Slot state | Required data | Notes |
| --- | --- | --- | --- |
| no lease | `available` | no lease reference | Slot may be allocated. |
| no lease | `quarantined` | diagnostic reason | Slot is blocked until repair or destroy. |
| no lease | `destroying` | destroy intent | Slot is being removed. |
| `preparing` | `leased` | `pendingAcquire` | Slot is reserved; checkout is incomplete. |
| `leased` | `leased` | finalized `target` | Normal durable lease. |
| `releasing` + preserve | `leased` | `pendingCleanup` | WAL state; returns to `leased` when complete. |
| `releasing` + reset | `leased` | `pendingCleanup` | Slot remains reserved until reset succeeds. |
| `destroying` | `destroying` | destroy intent | Lease and slot are being removed. |
| `quarantined` | `quarantined` | diagnostic reason | Slot must never be `available`. |
| reset complete | `available` | lease removed | Slot can be reused. |
| destroy complete | removed | lease removed | Slot directory and state are gone. |
| destroy failed | `quarantined` | diagnostics | Lease and slot both land in quarantine if partially removed. |

General rules:

- while a lease record exists, the slot must not be `available`;
- a `quarantined` lease requires a `quarantined` slot;
- a `destroying` lease requires a `destroying` slot;
- successful reset removes the lease but keeps the slot as `available`;
- successful destroy removes both lease and slot records;
- failed acquire, release, or destroy should never make a slot available.

### Busy And Idempotency Matrix

Concurrent calls should have explicit outcomes. Undefined combinations should be
treated as implementation bugs.

| Current lease state | Operation | Result |
| --- | --- | --- |
| `preparing` | `acquire` same lease | `ACQUIRE_IN_PROGRESS`; use `repair({ action: "resume-acquire" })`. |
| `preparing` | `acquire` different target | `ACQUIRE_IN_PROGRESS` or `LEASE_CONFLICT` if target can be compared safely. |
| `preparing` | `release` | `LEASE_BUSY`. |
| `preparing` | `destroy` | `LEASE_BUSY`; require repair or quarantine first. |
| `leased` | compatible `acquire` | Return existing lease. |
| `leased` | incompatible `acquire` | `LEASE_CONFLICT`. |
| `leased` | `release` | Enter `releasing`. |
| `leased` | `destroy` | Enter `destroying`. |
| `leased` | `repair quarantine` | Enter `quarantined`. |
| `releasing` | `acquire` | `LEASE_BUSY`. |
| `releasing` | `release` | `LEASE_BUSY`, except idempotent resume through repair. |
| `releasing` | `destroy` | `LEASE_BUSY`; require `repair({ action: "resume-cleanup" })` or quarantine first. |
| `destroying` | `acquire` | `LEASE_BUSY`. |
| `destroying` | `release` | `LEASE_BUSY`. |
| `destroying` | `destroy` same lease | Idempotent resume if destroy intent is present; otherwise `LEASE_BUSY`. |
| `quarantined` | `acquire` | `LEASE_QUARANTINED`. |
| `quarantined` | `release` | `LEASE_QUARANTINED`. |
| `quarantined` | `destroy` | Allowed with fresh process safety scan. |
| `quarantined` | `repair resume-acquire` | Allowed only with `pendingAcquire`; otherwise `REPAIR_NOT_AVAILABLE`. |
| `quarantined` | `repair resume-cleanup` | Allowed only with `pendingCleanup`; otherwise `REPAIR_NOT_AVAILABLE`. |
| removed | any mutator | `LEASE_NOT_FOUND`. |

### Preserve As Write-Ahead Release

All release policies should persist `pendingCleanup` and enter `releasing` before
side effects. This includes `cleanup: "preserve"`.

For preserve, `releasing` is not a destructive release. It is a write-ahead
state that makes clearing the active process reservation crash-recoverable. A
successful preserve transition clears active owner fields, clears
`pendingCleanup`, and returns the lease and slot to `leased`.

## Phase 1: Schemas, Errors, And State

Add Zod schemas for all boundary inputs and persisted state:

- `LeaseIdSchema`, using `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$`;
- `GroveLeaseTargetSchema`;
- `PendingAcquireSchema`;
- `GroveCleanupIntentSchema`;
- `GroveSlotSchema`;
- `GroveLeaseSchema`;
- top-level Grove state schema.

Add transition helpers:

- `transitionLease()`;
- `transitionSlot()`;
- `assertJointInvariants()`;
- transition-table tests for every lease state and event pair;
- tests proving mutators do not write state without transition helpers.

Add or confirm typed errors:

- `LEASE_NOT_FOUND`;
- `LEASE_CONFLICT`;
- `LEASE_ALREADY_EXISTS`;
- `LEASE_QUARANTINED`;
- `LEASE_BUSY`;
- `ACQUIRE_IN_PROGRESS`;
- `UNSAFE_CLEANUP`;
- `PROCESS_SAFETY_UNVERIFIED`;
- `BRANCH_EXISTS`;
- `BRANCH_NOT_FOUND`;
- `REF_NOT_FOUND`;
- `PATH_OUTSIDE_POOL`;
- `INVALID_INPUT`;
- `INVALID_TRANSITION`;
- `REPAIR_NOT_AVAILABLE`;
- `POOL_EXHAUSTED`;
- `INVALID_GROVE_STATE`;
- `LOCK_FAILED`;
- `GIT_COMMAND_FAILED`.

State reads should parse through schemas. Invalid JSON or invalid state shape
should throw `INVALID_GROVE_STATE`.

The top-level state schema and `assertJointInvariants()` should also enforce
cross-record invariants:

- no duplicate `leaseId` values;
- no duplicate active `slotName` values;
- no two leases point at the same slot;
- every leased slot has exactly one lease;
- every lease references an existing slot record;
- slot and lease states are consistent;
- no lease can be `leased` without a finalized `target`;
- no lease can be `preparing` without `pendingAcquire`;
- no lease can be `releasing` without `pendingCleanup`.

## Phase 2: Branch And Ref Validation

Validate branch and ref inputs before checkout:

- validate branch names with `git check-ref-format --branch`;
- resolve refs with `git rev-parse`;
- pass all branch/ref values as Git arguments, never shell-interpolated strings;
- store resolved SHA values in the normalized target.

For branch creation:

- `createBranch.from` becomes `target.createFromRef`;
- resolved SHA becomes `target.createFromSha`;
- `ifExists: "reuse"` must be explicit;
- `ifExists: "fail"` throws `BRANCH_EXISTS` if the branch exists.

Branch reuse must reject unsafe ambiguity:

- branch already belongs to another active lease;
- existing branch target conflicts with stored target;
- existing branch is checked out in another Grove-managed worktree;
- existing branch cannot be checked out by Git.

Branch reuse is a correctness rule, not an optional policy. On first acquire of
an existing branch, Grove may reuse it only if Git can check it out and no other
lease owns it. Once a lease exists, reacquire must compare the stored normalized
target and stored branch HEAD identity. If the branch has moved outside Grove's
expected lease state, fail with `LEASE_CONFLICT`.

## Phase 3: Acquire

Acquire flow:

1. Validate options.
2. Optionally fetch before resolving refs.
3. Resolve and normalize target.
4. Acquire state lock.
5. If lease exists, validate compatibility against stored normalized target.
6. If compatible and healthy, reserve active owner and return existing lease.
7. If incompatible, throw `LEASE_CONFLICT`.
8. Allocate an available slot.
9. Persist lease as `preparing` with `pendingAcquire`.
10. Release state lock.
11. Create or check out branch, or check out detached ref.
12. Read current `HEAD`.
13. Reacquire lock.
14. Finalize lease as `leased`.
15. Store `target`, `acquiredHeadSha`, and `currentHeadSha`.
16. Clear `pendingAcquire`.

If checkout fails, mark the lease `quarantined`. Do not return the slot to the
available pool automatically.

Idempotent reacquire must compare normalized target. For an existing lease,
moving refs like `origin/main` must not change the meaning of the lease.

Compatibility rules:

- branch reacquire requires the same `branch`;
- branch reacquire requires the same stored `createFromRef` and `createFromSha`
  when branch creation was used;
- branch reacquire requires the current branch HEAD to match the stored
  `branchHeadShaAtAcquire` unless Grove can prove the change was made inside the
  same durable lease;
- detached reacquire requires the same `requestedRef` and `resolvedRefSha`;
- mismatches throw `LEASE_CONFLICT`;
- reacquiring a `preparing` lease throws `ACQUIRE_IN_PROGRESS` unless the caller
  explicitly uses `repair({ action: "resume-acquire" })`.

## Phase 4: Inspect And List

`inspect(leaseId)` returns a single lease or `null`.

`list()` returns leases only in v1.

Both operations should:

- refresh `currentHeadSha` best-effort;
- include diagnostic process information when requested;
- avoid destructive repair;
- avoid state mutation;
- report missing worktree paths as `diagnostics.missingPath: true`.

This gives orchestrators a stable way to rehydrate work after process restart.
`inspect()` and `list()` should be read-only. If they detect missing paths,
invalid checkout state, or unavailable process safety, they should return
diagnostics and require explicit `repair()` for mutation.

## Phase 5: Release

Release supports three cleanup policies.

### Preserve

`cleanup: "preserve"` means the active process reservation is cleared, but the
durable lease remains.

Preserve still enters `releasing` first. This is write-ahead state, not semantic
destructive release. It lets `repair({ action: "resume-cleanup" })` safely
finish clearing active owner fields after a crash.

It must:

- never run `git reset --hard`;
- never run `git clean`;
- keep branch, commits, dirty files, and ignored files;
- leave the lease state as `leased`;
- clear only the active process reservation;
- return `{ status: "preserved", leaseId, lease }`.

### Reset

`cleanup: "reset"` means the lease is finished and the slot can return to the
available pool.

It must:

- perform a fresh process safety scan;
- require verified process safety unless `force: true`;
- persist `pendingCleanup` before side effects;
- reset to `resetTo`;
- clean untracked files;
- preserve ignored cache files by default with `git clean -fd`;
- support `cleanIgnored: true` for full cleanup;
- clear durable lease ownership after successful cleanup;
- return `{ status: "released", leaseId, slotName, path }`.

If reset fails, the lease should become `quarantined` with repair metadata. The
slot must not become `available`.

### Quarantine

`cleanup: "quarantine"` marks the lease unusable until explicit repair or
destroy.

It must:

- persist state as `quarantined`;
- clear pending cleanup;
- keep enough metadata for inspection;
- return `{ status: "quarantined", leaseId, lease }`.

## Phase 6: Destroy

Destroy removes a leased worktree and its state.

V1 should require `leaseId`.

Destroy flow:

1. Acquire state lock.
2. Find lease by `leaseId`.
3. Perform a fresh process safety scan.
4. Verify process safety unless `force: true`.
5. Mark lease `destroying`.
6. Persist destroy intent.
7. Release lock.
8. Canonicalize pool and target paths with `realpath()`.
9. Prove the target path is inside the pool path after canonicalization.
10. Remove the Git worktree.
11. Remove the physical slot directory.
12. Reacquire lock.
13. Remove lease and slot state.

Branch deletion should not be part of MVP. When added later, it must require:

- `deleteBranch: true`;
- branch matches a safe-delete prefix configured on `createGrove()`;
- local branch only.

## Phase 7: Repair

Repair should be explicit and conservative.

Supported actions:

- `quarantine`: mark lease quarantined and clear active owner fields.
- `resume-acquire`: resume a lease with `pendingAcquire`.
- `resume-cleanup`: resume a lease with `pendingCleanup`.
- `force-destroy`: destroy a lease with explicit force.

Rules:

- no TTL auto-destruction;
- no silent destructive repair;
- no guessing missing intent;
- `quarantine` is allowed from `leased`, `preparing`, `releasing`, and
  `destroying`;
- `quarantine` should move both lease and slot to `quarantined`;
- `resume-acquire` requires `pendingAcquire`;
- `resume-cleanup` requires `pendingCleanup`;
- missing repair preconditions throw `REPAIR_NOT_AVAILABLE`;
- failed repair should keep or move state to `quarantined`.

## Phase 8: CLI

The CLI should be lease-first and scriptable.

```bash
grove acquire --json \
  --lease-id job_abc123 \
  --branch agent/job_abc123 \
  --create-from origin/main

grove acquire --json \
  --lease-id validation_abc123 \
  --ref origin/main

grove inspect --json --lease-id job_abc123
grove list --json
grove release --json --lease-id job_abc123 --cleanup preserve
grove release --json --lease-id job_abc123 --cleanup reset --reset-to origin/main
grove release --json --lease-id job_abc123 --cleanup quarantine
grove repair --json --lease-id job_abc123 --action quarantine
grove repair --json --lease-id job_abc123 --action resume-acquire
grove repair --json --lease-id job_abc123 --action resume-cleanup
grove destroy --json --lease-id job_abc123
```

JSON output must use stable envelopes.

Success examples:

```json
{ "ok": true, "lease": {} }
```

```json
{ "ok": true, "result": { "status": "released", "leaseId": "job_abc123" } }
```

Error example:

```json
{
  "ok": false,
  "error": {
    "code": "LEASE_CONFLICT",
    "message": "Lease job_abc123 targets a different branch",
    "details": {}
  }
}
```

Requirements:

- stdout is machine-readable only in `--json` mode;
- human prose goes to stderr only;
- all errors use `error.code`, `error.message`, and `error.details`;
- exit codes distinguish invalid input, conflict, exhausted pool, Git failure,
  lock failure, and unsafe cleanup.

## Phase 9: Test Plan

Use real Git repositories. Do not mock Git.

Core integration tests:

- acquire branch lease creates branch from base ref and checks it out;
- acquire detached lease checks out requested ref;
- acquire same lease twice returns the same path when compatible;
- acquire same lease with different branch throws `LEASE_CONFLICT`;
- acquire same lease with different detached ref throws `LEASE_CONFLICT`;
- acquire persists `preparing` and `pendingAcquire` before checkout;
- failed branch checkout leaves lease quarantined;
- `repair({ action: "resume-acquire" })` resumes pending acquire;
- `release({ cleanup: "preserve" })` leaves commit reachable and branch checked
  out;
- preserve leaves dirty files untouched;
- preserve leaves lease state as `leased`;
- reset removes tracked and untracked changes;
- reset preserves ignored cache files by default;
- reset with `cleanIgnored: true` removes ignored cache files;
- reset clears durable lease and returns slot to available pool;
- failed reset leaves lease quarantined, not available;
- destructive cleanup refuses active processes unless forced;
- destructive cleanup refuses unverified process safety unless forced;
- destructive cleanup always performs a fresh process scan;
- destroy validates canonical path boundary before deletion;
- destroy removes worktree and state;
- corrupted state file throws `INVALID_GROVE_STATE`;
- inspect/list report missing worktree path without mutating state;
- missing repair preconditions throw `REPAIR_NOT_AVAILABLE`;
- duplicate leases or slot inconsistencies throw `INVALID_GROVE_STATE`;
- parallel acquire calls never return the same available slot;
- CLI `--json` emits no prose on stdout;
- CLI JSON errors follow the stable envelope.

Transition unit tests:

- every valid `(lease.state, LeaseEvent)` pair transitions to the expected state;
- every invalid `(lease.state, LeaseEvent)` pair throws the expected typed error;
- every valid `(slot.state, SlotEvent)` pair transitions to the expected state;
- every invalid `(slot.state, SlotEvent)` pair throws `INVALID_TRANSITION`;
- joint invariant tests reject duplicate lease IDs;
- joint invariant tests reject duplicate leased slots;
- joint invariant tests reject a lease pointing to an available slot;
- joint invariant tests reject `preparing` without `pendingAcquire`;
- joint invariant tests reject `releasing` without `pendingCleanup`;
- joint invariant tests reject a quarantined lease with a non-quarantined slot;
- destroy failure transitions both lease and slot to `quarantined`;
- preserve transitions `leased -> releasing -> leased`.

## MVP Scope

Implement first:

- lease state schema;
- normalized target;
- central transition helpers;
- joint slot-lease invariants;
- `preparing` and `pendingAcquire`;
- branch and detached acquire;
- idempotent reacquire;
- inspect and list;
- preserve, reset, and quarantine release;
- `ReleaseResult`;
- destroy by `leaseId`;
- process safety;
- canonical path safety;
- typed errors;
- cross-record state validation;
- JSON CLI envelopes;
- core integration tests.
- transition unit tests.

Defer:

- hooks;
- branch deletion;
- read-time legacy migration;
- `destroyAll`;
- richer repair beyond persisted intent;
- human-friendly CLI tables;
- event history;
- remote branch cleanup.

Read-time legacy migration is optional for a breaking v1. It is still pragmatic
if cheap: old entries can become available slots when their disk paths are valid.
Invalid or missing old entries should quarantine or be ignored with clear repair
guidance.

## Integration Branch and Release

Lease-first v1 is a **breaking change**. Do not land it on `main` incrementally.

Use a long-lived integration branch and one final merge to `main` for the major
release.

```text
main (stable, current semver — releasable)
  └─ feat/lease-first-v1 (integration branch)
       ├─ PR 1 → merge
       ├─ PR 2 → merge
       ├─ …
       └─ PR 6 → merge
            └─ feat/lease-first-v1 → main  (single breaking release)
```

**Branch roles**

| Branch | Role |
| --- | --- |
| `main` | Production line. No lease-first breaking API until integration merge. |
| `feat/lease-first-v1` | Integration branch. All PRs 1–6 merge here first. |
| `feat/lease-first-prN-*` | Short-lived implementation branches; base = `feat/lease-first-v1`. |

**Workflow rules**

- Every implementation PR (1–6) targets **`feat/lease-first-v1`**, not `main`.
- Keep **`feat/lease-first-v1` CI green** after each merged PR.
- **PR 6** removes legacy API surface; it is the last PR before release.
- When PR 6 is merged and CI is green, open **one PR**: `feat/lease-first-v1` → `main`.
- That merge ships **v1 major** via release-please. Use `feat!:` or a
  `BREAKING CHANGE:` footer on the final merge PR (or PR 6 commits) so semver
  bumps correctly.

**Current status**

- Integration branch: `feat/lease-first-v1` (created from `main`).
- PR 1: merged — `feat/lease-first-pr1-schemas-transitions` → `feat/lease-first-v1`.
- PR 2: merged — `feat/lease-first-pr2-acquire` → `feat/lease-first-v1`.
- PR 3: merged — `feat/lease-first-pr3-release` → `feat/lease-first-v1`.
- PR 4: in progress — `feat/lease-first-pr4-destroy` → `feat/lease-first-v1`.

## PR Split

Ship as **6 stacked PRs** merged into **`feat/lease-first-v1`**, each green before
the next. Use test-first per PR: add failing tests from Phase 9 for that slice,
implement, then run `pnpm test`, `pnpm typecheck`, and `pnpm build`.

Guiding rules:

- Foundation before behavior: slot/lease split and transitions land before
  mutators rely on them.
- One lifecycle stage per PR where possible; fold validation and read APIs into
  acquire to keep the stack at six PRs.
- Breaking cutover last: remove legacy `acquire()`, path-based `release()` and
  `destroy()`, and ephemeral `list()` only after lease-first paths work.
- CLI is a thin layer on top of a stable SDK contract.

```text
PR1 (schemas + transitions)
  └─ PR2 (validation + acquire + inspect/list)
       └─ PR3 (release)
            └─ PR4 (destroy)
                 └─ PR5 (repair + mutator enforcement)
                      └─ PR6 (breaking API + CLI)
```

### PR 1 — State model, schemas, and transitions

**Phases:** 1.

- Zod schemas: `GroveLeaseTarget`, `PendingAcquire`, `GroveSlot`, `GroveLease`,
  top-level state with `slots[]` and `leases[]`.
- Missing error codes and classes (`LEASE_BUSY`, `ACQUIRE_IN_PROGRESS`,
  `INVALID_TRANSITION`, `REPAIR_NOT_AVAILABLE`, `PROCESS_SAFETY_UNVERIFIED`,
  `INVALID_INPUT`, and others from Phase 1).
- `src/transitions.ts`: `transitionLease()`, `transitionSlot()`,
  `assertJointInvariants()`.
- Transition-table unit tests and joint invariant tests (Phase 9 transition section).
- State loader parses the new shape; throws `INVALID_GROVE_STATE` on invalid
  cross-record invariants.
- Optional cheap read-time migration from legacy `worktrees[]` to slots plus
  leases.

**Out of scope:** mutator rewrites in `pool.ts` beyond a thin adapter if needed.

### PR 2 — Validation, acquire, inspect, and list

**Phases:** 2, 3, 4; slice of 7 (`resume-acquire`).

- Branch and ref validation (`git check-ref-format --branch`, `git rev-parse`).
- Normalized `GroveLeaseTarget` resolution and storage.
- Full acquire flow: lock, `preparing` plus `pendingAcquire`, checkout, finalize
  `leased`.
- Idempotent reacquire against stored normalized target.
- `repair({ action: "resume-acquire" })`.
- Failed checkout leaves lease quarantined; slot must not return to available.
- `inspect(leaseId)` and `list()` returning `readonly GroveLease[]` only.
- Best-effort `currentHeadSha` refresh; `diagnostics.missingPath`; optional
  process info; read-only, no repair side effects.
- Integration tests: branch and detached acquire, reacquire compatibility,
  preparing persistence, failed checkout, resume-acquire, inspect and list
  diagnostics.

**Note:** keep legacy `acquire()` temporarily if needed for CI; mark deprecated.

### PR 3 — Release

**Phase:** 5; slice of 7 (`resume-cleanup`).

- `ReleaseResult` discriminated union (`preserved`, `released`, `quarantined`).
- All policies enter `releasing` and persist `pendingCleanup` first, including
  preserve.
- Reset: fresh process scan, `git reset`, `git clean -fd` (ignored preserved by
  default); `cleanIgnored: true` for full cleanup.
- Quarantine cleanup policy.
- `repair({ action: "resume-cleanup" })`.
- Integration tests: preserve dirty files and WAL, reset slot return, failed reset
  to quarantine, process safety on destructive cleanup.

### PR 4 — Destroy

**Phase:** 6 (MVP; no branch deletion).

- Destroy by `leaseId` only (path overload removed in PR 6).
- Fresh process scan; `force` bypass rules.
- `realpath` pool boundary check.
- `destroying` state and idempotent resume destroy.
- Failed destroy quarantines both lease and slot.
- Integration tests: path boundary, worktree removal, process safety, idempotent
  destroy.

**Carried over from PR 3 review (dedup refactors — do here, not in PR 3):**

- `assertWorktreeSafeForCleanup()` — consolidate `isWorktreeInUse` +
  `ownerAlive` + `UnsafeCleanupError` checks currently duplicated in
  `lease-release.ts` (`scanProcessSafety`), `pool.ts` (`destroy`, `destroyAll`,
  `repair` force-destroy). PR 4 rewrites destroy paths; one helper avoids a
  third copy and keeps release/destroy safety semantics aligned.
- `findLeaseByIdOrPath()` in `pool-state.ts` — same lookup in
  `lease-release.ts` `beginRelease()` and `pool.ts` `destroy()`. Extract when
  destroy is touched.
- `applyLeaseSlotQuarantine()` (or equivalent) — quarantine lease + slot
  transition pattern appears in `lease-acquire.ts`, `lease-release.ts`
  (`quarantineFailedRelease`, quarantine finalize), `pool.ts` repair, and will
  appear again on failed destroy. Single helper reduces drift across lifecycle
  stages.
- Merge `resumeCleanupLease()` repair transition + `loadReleasingContext()` into
  one locked pass (mirrors `resumeAcquireLease()`). Correct today; cosmetic only.
  Low priority unless PR 4 touches `resume-cleanup` again.

**Why deferred from PR 3:** PR 3 scope was release WAL + `ReleaseResult` only.
These refactors are cross-cutting (touch `pool.ts` destroy/repair as well as
`lease-release.ts`), widen the diff, and raise merge-conflict risk with PR 4's
destroy rewrite. No known behavioral bug once PR 3 post-review fixes land (hook
env, enrichment outside lock).

**Defer:** `deleteBranch` on destroy (already in codebase; out of MVP scope).

### PR 5 — Repair and transition enforcement

**Phase:** 7; enforce Phase 1 rule that mutators do not hand-edit state.

- Complete repair matrix: `quarantine`, `resume-acquire`, `resume-cleanup`,
  `force-destroy`.
- `REPAIR_NOT_AVAILABLE` when required intent is missing.
- Refactor `pool.ts` mutators to route all state changes through
  `transitions.ts`.
- Test that mutators never assign `lease.state` or `slot.state` directly.
- Integration tests: repair preconditions, quarantine from `preparing`,
  `releasing`, and `destroying`.

### PR 6 — Breaking API cutover and CLI

**Phase:** 8.

**SDK breaking changes:**

- Remove no-arg `acquire()` (ephemeral pool).
- Remove path-based `release()` and `destroy()`.
- `list()` returns leases only; drop `WorktreeStatus[]` and `listLeases()`.
- Remove or hide `destroyAll` (deferred feature).
- Align exports and types in `index.ts`.

**CLI:**

- Lease-first flags only (`--lease-id`, `--branch` or `--ref`, `--cleanup`, and
  so on).
- Stable JSON envelopes (`{ ok, lease }`, `{ ok, result }`, `{ ok: false, error }`).
- Human prose on stderr only in `--json` mode.
- Exit codes mapped to error codes.

**Tests:** CLI JSON stdout and stderr, error envelope shape.

Merge into `feat/lease-first-v1`; then ship `feat/lease-first-v1` → `main` as the
v1 breaking release.

### Out of MVP PR scope

Do not add separate PRs for: hooks, branch deletion on destroy, `destroyAll`,
read-time legacy migration (unless folded into PR 1), human-friendly CLI tables,
event history, or remote branch cleanup.

## Recommended Implementation Order

Work in PR order. Within each PR, follow test-first:

1. **PR 1:** Failing transition-table and joint invariant tests; schemas and
   typed errors; `transitions.ts`; state loader validation.
2. **PR 2:** Failing acquire, reacquire, inspect, and list integration tests;
   normalized target resolution; `preparing` and `pendingAcquire`; branch and
   detached acquire; `resume-acquire`; inspect and list lease views.
3. **PR 3:** Failing release integration tests; `ReleaseResult` and all cleanup
   policies; `resume-cleanup`.
4. **PR 4:** Failing destroy integration tests; canonical path-safe destroy;
   `destroying` state machine.
5. **PR 5:** Failing repair integration tests; complete repair matrix; enforce
   transition helpers in all mutators.
6. **PR 6:** Remove legacy API surface; CLI JSON envelopes; final integration
   and CLI tests; `pnpm test`, `pnpm typecheck`, `pnpm build`.

## Remaining Open Decisions

- Should `fetchOnAcquire` default to true for all lease acquires?
- Should `force: true` be persisted in returned metadata for auditability?
- Should `metadata` remain `Record<string, string>`, or allow JSON values?

## PR 1 Implementation Summary (Completed)

Branch: `feat/lease-first-pr1-schemas-transitions`

- **What was done**

  - Added the lease-first v1 data model as Zod schemas: `GroveLeaseTarget`
    (branch and detached), `PendingAcquire`, `GroveSlot`, `GroveLeaseRecord`, and
    `LeaseFirstGroveState` (`slots[]` + `leases[]`).
  - Added missing typed error codes and classes from Phase 1:
    `LEASE_BUSY`, `ACQUIRE_IN_PROGRESS`, `PROCESS_SAFETY_UNVERIFIED`,
    `INVALID_INPUT`, `INVALID_TRANSITION`, `REPAIR_NOT_AVAILABLE`, and
    `POOL_EXHAUSTED`.
  - Implemented `src/transitions.ts` with pure `transitionLease()`,
    `transitionSlot()`, `assertJointInvariants()`, and `createPreparingLease()`.
    Terminal removal returns `null`.
  - Implemented `src/state-v1.ts` for lease-first state I/O:
    `parseLeaseFirstState()`, `readLeaseFirstState()`, `writeLeaseFirstState()`,
    and `migrateLegacyToLeaseFirst()` for read-time `worktrees[]` migration.
  - Added 54 new unit tests covering transition tables, repair preconditions,
    joint slot-lease invariants, state parse/migrate/round-trip, and corrupt JSON
    handling.
  - Exported all new types, errors, transitions, and state-v1 APIs from
    `packages/grove/src/index.ts`.
  - Left `pool.ts` and legacy `readState` / `writeState` / `worktrees[]`
    unchanged so existing integration tests and ephemeral pool behavior keep
    working until PR 2.

- **How it was done**

  - Extended `schemas.ts` with v1 schemas below the legacy `GroveState` block.
    `GroveLeaseSchema` uses `superRefine` to enforce state-dependent fields
    (`preparing` requires `pendingAcquire`, `leased` requires `target`,
    `releasing` requires `pendingCleanup`).
  - Built `transitions.ts` as the single authority for slot and lease state
    changes, matching the plan's event types and state diagrams. Invalid
    transitions throw `InvalidTransitionError`; repair without persisted intent
    throws `RepairNotAvailableError`.
  - `assertJointInvariants()` validates cross-record rules after every v1 parse
    and write: duplicate `leaseId`, duplicate slot leases, lease/slot path
    mismatch, lease on available slot, quarantined/destroying state pairing, and
    missing required intent fields.
  - `state-v1.ts` detects on-disk format: native `slots`/`leases` parses
    directly; legacy `worktrees` migrates in memory then re-validates. Empty
    file returns `{ slots: [], leases: [] }`.
  - Test-first: `transitions.test.ts` and `state-v1.test.ts` written alongside
    implementation. Full suite green: 122 tests, `pnpm check` passes.

- **Why it was done**

  - PR 1 is the foundation for the entire lease-first v1 rewrite. Separating
    physical slots from durable leases and centralizing transitions prevents the
    inline state mutation bugs the plan calls out in `pool.ts`.
  - Joint invariants and WAL-shaped lease states (`preparing`, `releasing`) must
    exist before acquire and release mutators are rewritten in PR 2 and PR 3.
  - Keeping legacy state I/O intact avoids a big-bang break: PR 2 can adopt v1
    state incrementally while existing lease integration tests still run against
    the current pool implementation.
  - Read-time legacy migration gives a cheap upgrade path for on-disk
    `grove-state.json` files without requiring a separate migration PR.

- **Files worked on**

  - `packages/grove/src/schemas.ts` — v1 Zod schemas and types
  - `packages/grove/src/errors.ts` — new error codes and error classes
  - `packages/grove/src/transitions.ts` — transition helpers and joint invariants (new)
  - `packages/grove/src/state-v1.ts` — lease-first parse, read, write, migrate (new)
  - `packages/grove/src/index.ts` — public exports for v1 APIs
  - `packages/grove/test/transitions.test.ts` — transition and invariant tests (new)
  - `packages/grove/test/state-v1.test.ts` — state loader and migration tests (new)

## PR 2 Implementation Summary (Completed)

Branch: `feat/lease-first-pr2-acquire`

- **What was done**

  - Added `validateBranchName()` (`git check-ref-format --branch`) and
    `buildAcquireTarget()` / `assertCompatibleReacquire()` in `target.ts`.
  - Implemented v1 lease acquire with WAL: `preparing` + `pendingAcquire`, checkout
    side effects, `ACQUIRE_COMPLETE` / `ACQUIRE_FAILED` transitions, and
    quarantined failure handling.
  - Added `repair({ action: "resume-acquire" })` via `resumeAcquireLease()`.
  - Migrated pool persistence to `slots[]` + `leases[]` through `pool-state.ts`
    (`loadPoolState`, `savePoolState`, `findOrAllocateSlot`, heal/recovery).
  - Rewired `inspect()` and `list()` to read-only lease views with best-effort
    `currentHeadSha` refresh and `diagnostics.missingPath`.
  - Added `listWorktreeStatus()` for ephemeral slot listing; `list()` now returns
    leases only per v1 contract.
  - Bridged release/destroy/destroyAll to v1 state with transition helpers where
    applicable (full release WAL polish remains PR 3).
  - Added `REPAIR_RESUME_LEASE` slot transition and slot `ownerPid` fields for
    process reservation persistence.
  - Extended integration and unit tests: target resolution, resume-acquire,
    inspect/list diagnostics, pendingAcquire on failed checkout.

- **How it was done**

  - `lease-acquire.ts` orchestrates the plan's acquire flow using
    `withStateLock`, `transitionLease`, and `transitionSlot`.
  - `lease-view.ts` maps `GroveLeaseRecord` to public `GroveLease`, enriching
    read-only diagnostics without mutating persisted state.
  - `pool.ts` delegates lease acquire to `acquireLease()`; ephemeral
    acquire/release uses v1 slots without lease records.
  - Reacquire compares normalized `GroveLeaseTarget` fields; omitted
    `createBranch` on reacquire does not conflict with stored `createFromRef`.
  - CLI `status` uses `listWorktreeStatus()` for ephemeral slot display.

- **Why it was done**

  - PR 2 delivers the core lease lifecycle entry point: durable acquire with
    crash-recoverable intent, idempotent reacquire, and read APIs orchestrators
    need after process restart.
  - Unified on-disk v1 state is required before release/destroy can be fully
    transition-driven in PR 3–5.

- **Files worked on**

  - `packages/grove/src/target.ts` (new)
  - `packages/grove/src/pool-state.ts` (new)
  - `packages/grove/src/lease-view.ts` (new)
  - `packages/grove/src/lease-acquire.ts` (new)
  - `packages/grove/src/pool.ts` — v1 state integration
  - `packages/grove/src/queries.ts` — v1 `listWorktrees`
  - `packages/grove/src/git/branch.ts` — `validateBranchName`
  - `packages/grove/src/schemas.ts` — slot owner fields
  - `packages/grove/src/transitions.ts` — `REPAIR_RESUME_LEASE`
  - `packages/grove/src/types.ts` — `GroveLease` v1 fields, `resume-acquire`
  - `packages/grove-cli/src/commands/status.ts`
  - `packages/grove/test/target.test.ts` (new)
  - `packages/grove/test/lease.integration.test.ts`
  - `packages/grove/test/pool.test.ts`, `grove.integration.test.ts`
  - `packages/grove/test/helpers/hook-probe.mjs`
  - `grove-v1-lease-first-implementation-plan.md`

## PR 3 Implementation Summary (Completed)

Branch: `feat/lease-first-pr3-release`

- **What was done**

  - Added `ReleaseResult` discriminated union (`preserved`, `released`, `quarantined`).
  - Implemented `lease-release.ts` with WAL release: all policies enter `releasing`
    and persist `pendingCleanup` before side effects.
  - Reset: fresh process scan, `git reset --hard`, `git clean -fd` (or `-fdx` with
    `cleanIgnored: true`), `RELEASE_RESET_COMPLETE`, slot `RELEASE_TO_POOL`.
  - Preserve: clears owner only via `RELEASE_PRESERVE_COMPLETE`; no git reset/clean.
  - Quarantine cleanup policy via `RELEASE_START` + `QUARANTINE` finalize.
  - Failed reset quarantines lease and slot; preserves `pendingCleanup` for repair.
  - `repair({ action: "resume-cleanup" })` via `resumeCleanupLease()` (handles
    quarantined and interrupted `releasing` states).
  - CLI release/repair commands updated for `ReleaseResult` return type.
  - Post-review fixes: shared `buildLeaseHookEnv()` (README hook contract for all
    lifecycle hooks), `enrichLeaseReadOnly()` moved outside the state lock in
    finalize, single process scan on reset `beginRelease`, lazy `getDefaultBranch`
    only when reset omits `resetTo`, `isReleaseResult()` for CLI narrowing,
    `quarantineFailedRelease` throws instead of silent no-op.

- **How it was done**

  - `releaseLease()` and `resumeCleanupLease()` share `completeRelease()` for
    hooks, reset side effects, and transition-driven finalize.
  - `toLeaseFirstCleanupIntent()` normalizes reset options with default branch.
  - `pool.ts` delegates lease release and resume-cleanup to `lease-release.ts`.
  - `buildLeaseHookEnv()` in `lease-view.ts` is the single hook env builder for
    acquire, release, and destroy.

- **Why it was done**

  - PR 3 delivers durable release with crash-recoverable cleanup intent and typed
    results orchestrators need before destroy/repair enforcement in PR 4–5.

- **Deferred to PR 4 (and why)**

  - **Process-safety helper** (`assertWorktreeSafeForCleanup`) — duplicated across
    release and destroy paths; extract when PR 4 rewrites destroy (see PR 4
    section).
  - **Lease lookup helper** (`findLeaseByIdOrPath`) — same id-or-path lookup in
    release and destroy; extract alongside destroy.
  - **Quarantine transition helper** — four similar call sites today; PR 4 adds a
    fifth on failed destroy — better to dedupe once destroy lands.
  - **`resume-cleanup` double lock** — repair transition and context load are two
    locked sections; merge is cosmetic, not a correctness gap.
  - **`repair()` return union** (`GroveLease | ReleaseResult | void`) — defer typed
    `RepairResult` or action overloads to **PR 5** (repair matrix + mutator
    enforcement); `isReleaseResult()` is sufficient for CLI until then.

- **Files worked on**

  - `packages/grove/src/lease-release.ts` (new)
  - `packages/grove/src/lease-view.ts` — `buildLeaseHookEnv`
  - `packages/grove/src/types.ts` — `ReleaseResult`, `isReleaseResult`
  - `packages/grove/src/git/worktree.ts` — `cleanIgnored` on reset
  - `packages/grove/src/pool.ts` — delegate release/repair cleanup
  - `packages/grove/src/index.ts` — export `ReleaseResult`, `isReleaseResult`
  - `packages/grove-cli/src/commands/release.ts`, `repair.ts`
  - `packages/grove/test/lease.integration.test.ts`
  - `grove-v1-lease-first-implementation-plan.md`

## PR 4 Implementation Summary (Completed)

Branch: `feat/lease-first-pr4-destroy`

- **What was done**

  - Implemented `lease-destroy.ts` with transition-driven destroy: `DESTROY_START`,
    physical removal, `DESTROY_COMPLETE`, and `DESTROY_FAILED` quarantine.
  - Fresh process safety scan before destructive removal (after `preDestroy`);
    `ignoreOwnerReservation` for Grove's own destroy reservation.
  - `realpath` pool boundary check via `assertPathWithinPool()` before removal.
  - Idempotent resume when lease and slot are already `destroying`.
  - Failed destroy quarantines lease (`DESTROY_FAILED`) and slot (`QUARANTINE`).
  - Extracted `assertWorktreeSafeForCleanup()`, `findLeaseByIdOrPath()`,
    `applyLeaseSlotQuarantine()`, and `assertPathWithinPool()`.
  - `loadPoolState({ heal: false })` for finalize paths after physical delete.

- **How it was done**

  - `destroyLease()` / `destroyEphemeralSlot()` share begin/complete destroy flow.
  - `pool.ts` delegates destroy and `destroyAll` to lease-destroy module.
  - `lease-release.ts` uses shared cleanup safety and lease lookup helpers.
  - Slot `QUARANTINE` allowed from `destroying` for failed-destroy recovery.

- **Why it was done**

  - PR 4 delivers path-safe, process-safe destroy with crash-recoverable
    `destroying` state before repair enforcement in PR 5.

- **Files worked on**

  - `packages/grove/src/lease-destroy.ts` (new)
  - `packages/grove/src/process/cleanup-safety.ts` (new)
  - `packages/grove/src/path-boundary.ts` (new)
  - `packages/grove/src/pool-state.ts`
  - `packages/grove/src/pool.ts`
  - `packages/grove/src/lease-release.ts`
  - `packages/grove/src/transitions.ts`
  - `packages/grove/test/lease.integration.test.ts`
  - `packages/grove/test/transitions.test.ts`
  - `grove-v1-lease-first-implementation-plan.md`
