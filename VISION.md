# Grove Vision

Grove is a standalone TypeScript SDK and CLI for managing pools of reusable git worktrees.

It helps applications (like downstream orchestrators or CLI tools) maintain an isolated pool of worktrees for any repository. By acquiring an instantly available worktree and returning it to the pool after use, applications avoid the steep overhead of deep cloning or fetching repositories repeatedly, while preserving dependencies and build caches.

## North Star

Provide a robust and reliable implementation of git worktree pool semantics — both ephemeral clean-job checkouts and durable branch-aware leases.

The SDK should feel:

- fast, precise, and dependable;
- respectful of running processes and system resources;
- composable, offering primitives rather than rigid opinions on policy.

The SDK should not be:

- an agent runner or workflow manager;
- an interactive shell spawner (the CLI may offer `--shell` for convenience, but Grove does not own job lifecycle);
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

When a CI job or bot needs to operate on a repository without disrupting a user's current branch or another concurrent job, standard checkouts cause conflicts. Grove manages a structured pool of isolated worktrees so each job gets its own checkout — detached HEAD for ephemeral jobs, or a specific branch for leased work units.

### Durable Work-Unit Isolation

Downstream orchestrators often need the same worktree across multiple process invocations (create, resume, finalize). Ephemeral acquire/release destroys commits on every release. Lease mode persists ownership by `leaseId`, supports idempotent re-acquire, and separates cleanup intent (`preserve`, `reset`, `quarantine`, `destroy`) from reservation.

### Process Safety

Handing out or destructively cleaning a worktree that is currently in use leads to corruption and failures. Grove implements PID owner reservations and filesystem-level `cwd` scanning. When scanning is unavailable, destructive cleanup requires explicit `force: true` and reports `processSafety: "unverified"`.

### Concurrency and State

Managing pool state concurrently requires strict synchronization. Grove uses cross-platform file locking (`proper-lockfile`) to serialize `grove-state.json` mutations.

## Architecture and Scope

The core architecture wraps Git operations, process detection, and state locking under a unified facade (`createGrove`).

### What We Are Building

**Ephemeral pool (v0.1+):**

- **Acquire/Release:** Check out clean detached-HEAD worktrees; reset on return.
- **Process Detection:** Unix-based `cwd` scan to identify active worktrees.
- **Hooks:** `postCreate`, `preDestroy`.
- **State Persistence:** JSON state with exclusive file locking.

**Lease mode (v0.3+):**

- **Branch-aware acquire:** Checkout existing branch, create branch from ref, or detached ref.
- **Durable leases:** Stable `leaseId`, persisted across process restarts, idempotent re-acquire.
- **Cleanup policies:** `preserve`, `reset`, `quarantine`; explicit `destroy()` with optional safe branch deletion.
- **Repair:** Resume stuck cleanup, quarantine, or force-destroy.
- **Extended hooks:** `postAcquire`, `preRelease`, `postRelease` with lease env vars.
- **CLI:** Scriptable commands with `--json` for orchestrator integration.

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

The primary directive is **Faithful port first** for ephemeral pool semantics: the original Go behavior is the specification.

For lease mode, acceptance tests in `packages/grove/test/lease.integration.test.ts` define expected behavior.

Prefer changes that:

- map cleanly to established pool and lease semantics;
- use stable error codes from `packages/grove/src/errors.ts`;
- rely on test-first development with real git (no mocked git in pool/integration tests).

Avoid changes that:

- introduce speculative features beyond the PRD without explicit scope;
- mock `git` in pool tests (use `setupRepo()` from test helpers);
- push lifecycle or workflow policy into Grove (keep it policy-light).
