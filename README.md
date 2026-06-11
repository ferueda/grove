# Grove

> A fast, secure pool of reusable git worktrees

Grove is a tool and standalone TypeScript SDK that manages a pool of Git worktrees. Instead of re-cloning repositories or suffering through long `git fetch` operations for concurrent jobs, Grove maintains a pool of fast, clean, and isolated worktrees.

When your application, agent, or shell needs a clean workspace, it instantly acquires a detached-HEAD worktree from the pool. When the job is finished, the worktree is reset and released back to the pool—keeping dependencies (`node_modules`), build caches, and ignored files completely intact for the next run!

## Features

- **Blazing Fast Acquisition:** Instantly get a clean, detached-HEAD checkout. `node_modules` survive across acquisitions because we use `git clean -fd` (not `-xfd`), avoiding slow reinstalls!
- **Auto-Syncing:** Reused worktrees automatically run `git fetch` and `git reset --hard` to the default branch to instantly sync with remote changes.
- **Process Detection & Quarantine:** Safely prevents claiming worktrees that are currently in use by active OS processes (via `lsof`). If you release a worktree but forget to kill a background compiler inside it, Grove quarantines it!
- **State & Locking:** Reliable cross-platform file locking safely handles concurrent acquisitions across different terminal windows and parallel CI jobs.

---

## The Grove CLI

Grove ships with a powerful CLI for your daily development workflow.

### Installation

Install the CLI globally to access it from anywhere:

```bash
pnpm add -g @ferueda/grove-cli
# Or using npm
npm install -g @ferueda/grove-cli
```

### Usage

Run Grove commands from inside any Git repository. Grove will automatically detect the repository and create the pool in `~/.grove/<hash>/`.

#### Acquiring a Worktree

```bash
# Interactive Mode: Drops you into a fresh interactive subshell inside the worktree
grove acquire --shell

# Programmatic Mode: Prints the path to the allocated worktree
grove acquire
```

If you use Programmatic Mode, you can combine it with `cd` to navigate there:
```bash
cd $(grove acquire)
```

#### Releasing a Worktree

When you are done with a worktree, run `grove release` to reset it to `main` and return it to the pool:

```bash
grove release
```

*Note: If you are physically inside the worktree when you run release, the worktree will be temporarily quarantined (status: `you're here`) to protect other users until you `cd` out of it.*

#### Checking Pool Status

To see all available, in-use, and dirty worktrees in your pool:

```bash
grove status
```
This dynamically scans the OS to display what processes are running inside each worktree.

#### Cleaning Up

```bash
# Destroy a specific worktree by ID
grove destroy 1

# Destroy all worktrees in the pool for this repository
grove destroy-all
```

---

## The Programmatic SDK

If you are building an AI agent, CI runner, or automation script, you can use Grove as a programmable SDK.

### Installation

```bash
pnpm add @ferueda/grove
```

### Quick Start

```typescript
import { createGrove } from "@ferueda/grove";

// Initialize the Grove pool manager for your repository
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

### API Reference

#### `createGrove(config)`
Initializes a `Grove` pool manager instance.
- **`repoRoot`** (string, required): Absolute path to the main Git repository.
- **`groveRoot`** (string, optional): Parent directory where the worktree pool will live. Defaults to `~/.grove/`.
- **`groveDir`** (string, optional): Full absolute path to use for the pool state and checkouts. (Takes precedence over `groveRoot`).
- **`maxTrees`** (number, optional): Max slots in the pool (default `16`).
- **`fetchOnAcquire`** (boolean, optional): Whether to run `git fetch origin` before acquiring (default `true`).
- **`hooks`** (optional): Lifecycle hooks (`postCreate`, `preDestroy`).

#### `Grove` Manager Instance
- **`acquire()`**: Returns `Promise<AcquiredSlot>` (`{ path: string; name: string; }`). Allocates an available slot or creates a new one.
- **`release(path)`**: Returns `Promise<void>`. Detaches and resets the worktree to the default branch, clearing the owner reservation.
- **`list()`**: Returns `Promise<WorktreeStatus[]>`. Lists all tracked slots, active process PIDs inside them, and status (`available`, `in-use`, `dirty`, `you're here`).
- **`destroy(path, options)`**: Returns `Promise<void>`. Removes the worktree slot from disk and pool state.
- **`destroyAll(options)`**: Returns `Promise<void>`. Removes all worktree slots from disk and pool state.
