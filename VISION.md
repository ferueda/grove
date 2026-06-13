# Grove Vision

Grove is a standalone TypeScript SDK and CLI for managing pools of reusable git worktrees.

It helps applications (like downstream orchestrators or CLI tools) maintain an isolated pool of worktrees for any repository. By acquiring an instantly available worktree and returning it to the pool after use, applications avoid the steep overhead of deep cloning or fetching repositories repeatedly, while preserving dependencies and build caches.

## North Star

Provide a robust and reliable implementation of git worktree pool semantics as durable, branch-aware leases keyed by `leaseId`.

The SDK should feel:

- fast, precise, and dependable;
- respectful of running processes and system resources;
- composable, offering primitives rather than rigid opinions on policy.

The SDK should not be:

- an agent runner or workflow manager;
- an interactive shell spawner;
- an opinionated PR/review/validation system;
- a config-file-driven product (v0.x relies on programmatic `createGrove()` configuration).

## Who Grove Helps

Primary users are downstream systems, bots, or CLIs built on top of Node.js.

They may have:

- a need to run concurrent tasks against different branches of the same repository;
- long-running orchestrator work units that need durable, branch-specific checkouts;
- large repositories where cloning takes too much time;
- complex caching needs (like `node_modules`) that benefit from reusing an existing directory.

Grove helps by exposing a programmatically controllable worktree allocator with optional durable leases.

## Problems We Solve

### Checkout Contention

When a CI job or bot needs to operate on a repository without disrupting a user's current branch or another concurrent job, standard checkouts cause conflicts. Grove manages a structured pool of isolated worktrees so each job gets its own checkout on a specific branch or detached ref, tied to a stable `leaseId`.

### Durable Work-Unit Isolation

Downstream orchestrators often need the same worktree across multiple process invocations (create, resume, finalize). Grove persists ownership by `leaseId`, supports idempotent re-acquire, and separates cleanup intent (`preserve`, `reset`, `quarantine`, `destroy`) from reservation.

### Process Safety

Handing out or destructively cleaning a worktree that is currently in use leads to corruption and failures. Grove implements PID owner reservations and filesystem-level `cwd` scanning. When scanning is unavailable, destructive cleanup requires explicit `force: true` and reports `processSafety: "unverified"`.

### Concurrency and State

Managing pool state concurrently requires strict synchronization. Grove uses cross-platform file locking (`proper-lockfile`) to serialize `grove-state.json` mutations.

## Architecture and Scope

The core architecture wraps Git operations, process detection, and state locking under a unified facade (`createGrove`).

### What We Are Building (v1)

- **Branch-aware acquire:** Checkout existing branch, create branch from ref, or detached ref.
- **Durable leases:** Stable `leaseId`, persisted across process restarts, idempotent re-acquire.
- **Cleanup policies:** `preserve`, `reset`, `quarantine`; explicit `destroy()`.
- **Repair:** Resume stuck acquire/cleanup, quarantine, or force-destroy.
- **Process detection:** Unix-based `cwd` scan; fresh safety scan before destructive ops.
- **Hooks:** `postCreate`, `postAcquire`, `preRelease`, `postRelease`, `preDestroy` with lease env vars.
- **CLI:** Lease-first commands with stable `--json` envelopes.
- **State persistence:** JSON state with exclusive file locking and transition-driven mutations.

### What We Are Not Building

- Agent execution or state-machine orchestration (callers own lifecycle).
- PR creation, review, or validation policy.
- Remote push/upstream tracking (orchestrator responsibility).
- Config file loaders (TOML/YAML).
- Custom git implementations (we shell out to `git` via `execa`).
- Full Windows support for process cwd-scanning.

## Data And Integration Principles

Grove state must always match disk reality.

- `grove-state.json` is the single source of truth for the pool and leases.
- Mutations acquire an exclusive file lock (`grove-state.lock`).
- `healState()` runs on read to purge stale entries (e.g. manually deleted directories).
- Lease cleanup intent is persisted before entering `releasing` or `destroying` so `repair({ action: "resume-cleanup" })` can resume the exact operation.
- No TTL auto-destruction by default; stuck states require explicit repair.

## Agent And Contributor Guardrails

Acceptance tests in `packages/grove/test/lease-*.integration.test.ts` define expected lease behavior (acquire, hooks, release, repair, destroy).
Transition rules live in `packages/grove/test/transitions.test.ts`.

Prefer changes that:

- map cleanly to established pool and lease semantics;
- use stable error codes from `packages/grove/src/errors.ts`;
- rely on test-first development with real git (no mocked git in pool/integration tests).

Avoid changes that:

- introduce speculative features beyond the PRD without explicit scope;
- mock `git` in pool tests (use `setupRepo()` from test helpers);
- push lifecycle or workflow policy into Grove (keep it policy-light).
