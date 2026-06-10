# grove Vision

grove is a standalone TypeScript SDK for managing pools of reusable git worktrees.

It helps applications (like downstream orchestrators or CLI tools) maintain an isolated pool of clean worktrees for any repository. By acquiring an instantly available worktree and returning it to the pool after use, applications avoid the steep overhead of deep cloning or fetching repositories repeatedly, while preserving dependencies and build caches.

## North Star

Provide a robust and reliable implementation of git worktree pool semantics.

The SDK should feel:

- fast, precise, and dependable;
- respectful of running processes and system resources;
- composable, offering primitives rather than rigid opinions on policy.

The SDK should not be:

- a user-facing CLI (in v0.1);
- an interactive shell spawner;
- an opinionated workflow manager.

## Who grove Helps

Primary users are downstream systems, bots, or CLIs built on top of Node.js.

They may have:

- a need to run concurrent tasks against different branches of the same repository;
- large repositories where cloning takes too much time;
- complex caching needs (like `node_modules`) that benefit from reusing an existing directory.

grove helps by exposing a programmatically controllable worktree allocator.

## Problems We Solve

### Checkout Contention

When a CI job or bot needs to operate on a repository without disrupting a user's current branch or another concurrent job, standard checkouts cause conflicts. `grove` manages a structured pool of isolated worktrees so each job gets a clean, detached-HEAD checkout.

### Process Safety

Handing out a worktree that is currently being used by another process leads to corruption and failures. `grove` implements a combination of PID owner reservations and filesystem-level `cwd` scanning to prevent checking out worktrees that are in use.

### Concurrency and State

Managing the pool state concurrently requires strict synchronization. `grove` uses robust, cross-platform file locking (`proper-lockfile`) to ensure `grove-state.json` mutations are entirely serialized.

## Architecture and Scope

The core architecture wraps Git operations, Process detection, and State locking under a unified facade (`createGrove`).

### What We Are Building (v0.1)

- **Acquire/Release:** Check out clean worktrees, reset them on return.
- **Process Detection:** Unix-based `cwd` scan to safely identify active worktrees.
- **Hooks:** Pre-destroy and post-create shell hooks.
- **State Persistence:** JSON-based state tracking with exclusive file locking.

### What We Are Not Building (v0.1)

- Interactive CLI prompts or subshell spawning.
- Built-in self-updaters.
- Config file loaders (TOML/YAML)—v0.1 relies exclusively on programmatic configuration.
- Custom git implementations (we shell out to `git` via `execa`).
- Full Windows support for process cwd-scanning.

## Data And Integration Principles

`grove` state must always match disk reality.

- `grove-state.json` acts as the single source of truth for the pool.
- Operations that mutate state must acquire an exclusive file lock (`grove-state.lock`).
- `healState()` runs on read to silently purge stale entries (e.g. tracking a directory that was deleted manually).

## Agent And Contributor Guardrails

The primary directive is **Faithful port first**: The original Go behavior is the specification.

Prefer changes that:

- map cleanly to the established pool semantics;
- use the exact error shapes defined in `src/errors.ts`;
- rely on `test-first` porting directly from the Go test cases.

Avoid changes that:

- introduce speculative features before parity is achieved;
- mock `git` in pool tests (use real git via the provided test helpers);
- add complex UI or terminal manipulation code inside the SDK boundaries.
