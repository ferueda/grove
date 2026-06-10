# grove

> a pool of reusable git worktrees

`grove` is a standalone TypeScript SDK that allows any application to manage a pool of Git worktrees programmatically. 

Instead of re-cloning repositories or suffering through long `git fetch` operations for concurrent jobs, `grove` maintains a pool of fast, clean, and isolated worktrees. When your application or agent needs a clean workspace, it instantly acquires a detached-HEAD worktree from the pool. When the job is finished, the worktree is reset and released back to the pool—keeping dependencies, node_modules, and build caches intact for the next run.

### Features
- **Fast Acquisition:** Instantly get a clean, detached-HEAD checkout.
- **Process Detection:** Safely prevents claiming worktrees that are currently in use by other active processes.
- **State & Locking:** Reliable cross-platform file locking to safely handle concurrent acquisitions.
- **Lifecycle Hooks:** Configure `postCreate` or `preDestroy` shell hooks to manage setup and teardown (e.g., running `pnpm install`).
