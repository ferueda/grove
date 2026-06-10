# grove

> a pool of reusable git worktrees

`grove` is a standalone TypeScript SDK that allows any application to manage a pool of Git worktrees programmatically.

Instead of re-cloning repositories or suffering through long `git fetch` operations for concurrent jobs, `grove` maintains a pool of fast, clean, and isolated worktrees. When your application or agent needs a clean workspace, it instantly acquires a detached-HEAD worktree from the pool. When the job is finished, the worktree is reset and released back to the pool—keeping dependencies, node_modules, and build caches intact for the next run.

### Features

- **Fast Acquisition:** Instantly get a clean, detached-HEAD checkout.
- **Process Detection:** Safely prevents claiming worktrees that are currently in use by other active processes.
- **State & Locking:** Reliable cross-platform file locking to safely handle concurrent acquisitions.
- **Lifecycle Hooks:** Configure `postCreate` or `preDestroy` shell hooks to manage setup and teardown (e.g., running `pnpm install`).

## Installation

```bash
pnpm add grove
```

## Quick Start

```typescript
import { createGrove } from "grove";

// Initialize the grove pool manager for your repository
const grove = await createGrove({
  repoRoot: "/absolute/path/to/my-repo",
  maxTrees: 8,
  hooks: {
    postCreate: ["pnpm install"], // runs inside the worktree immediately after creation
  },
});

// Acquire a clean, isolated worktree slot
const slot = await grove.acquire();
console.log(`Worktree acquired: ${slot.path} (ID: ${slot.name})`);

// Do your work inside slot.path...

// Reset and release the worktree slot back to the pool when finished
await grove.release(slot.path);
```

## API Reference

### `createGrove(config)`
Validates the configuration with Zod and initializes a `Grove` pool manager instance.
- **`repoRoot`** (string, required): Absolute path to the main Git repository.
- **`groveRoot`** (string, optional): Parent directory where the worktree pool will live. Defaults to `~/.grove/`.
- **`groveDir`** (string, optional): Full absolute path to use for the pool state and checkouts. (Takes precedence over `groveRoot`).
- **`maxTrees`** (number, optional): Max slots in the pool (default `16`).
- **`fetchOnAcquire`** (boolean, optional): Whether to run `git fetch origin` before acquiring (default `true`).
- **`hooks`** (optional): Lifecycle hooks (`postCreate`, `preDestroy`).

### `Grove` Manager Instance
- **`acquire()`**: Returns `Promise<AcquiredSlot>` (`{ path: string; name: string; }`). Allocates an available slot or creates a new one.
- **`release(path)`**: Returns `Promise<void>`. Detaches and resets the worktree to the default branch, clearing the owner reservation.
- **`list()`**: Returns `Promise<WorktreeStatus[]>`. List all tracked slots, active process PIDs inside them, and status (`available`, `in-use`, `dirty`, `you're here`).
- **`destroy(path, options)`**: Returns `Promise<void>`. Force or non-force removes the worktree slot from disk and pool state.
- **`destroyAll(options)`**: Returns `Promise<void>`. Force or non-force removes all worktree slots from disk and pool state.

## Parity with Go Treehouse

`grove` is a faithful TypeScript port of the Go `treehouse` pool manager. 
A complete mapping of Go test behaviors to TypeScript vitest assertions can be found in the [Parity Matrix](docs/parity-matrix.md).

## Attribution

This SDK is inspired by and ported from the Go pool allocator in [kunchenguid/treehouse](https://github.com/kunchenguid/treehouse).
