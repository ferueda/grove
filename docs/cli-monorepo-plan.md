# Grove CLI & Monorepo Transition Plan

This document outlines the architecture and execution plan for separating the `grove` core SDK and the command-line interface (CLI) into separate packages within a monorepo workspace.

---

## 1. Monorepo Target Architecture

We will transition the repository into a `pnpm` workspace monorepo. This allows us to keep the core SDK clean of CLI dependencies while maintaining both packages in a single repository for streamlined development and testing.

### Workspace Directory Layout

```
grove/
├── package.json                   # Root package (workspace tasks, tooling configs)
├── pnpm-workspace.yaml            # Defines package workspaces
├── tsconfig.json                  # Shared root TypeScript configuration
├── packages/
│   ├── grove/                     # Core SDK Package
│   │   ├── package.json           # name: "grove", version: "0.1.0"
│   │   ├── tsconfig.json
│   │   ├── src/                   # Existing SDK code
│   │   └── test/                  # Existing SDK tests
│   │
│   └── grove-cli/                 # CLI Wrapper Package
│       ├── package.json           # name: "grove-cli", version: "0.1.0", bin: { "grove": "./dist/cli.js" }
│       ├── tsconfig.json
│       ├── src/
│       │   ├── cli.ts             # CLI entrypoint
│       │   └── commands/          # Subcommand handlers
│       └── test/                  # CLI-specific verification tests
```

---

## 2. Package Breakdown

### Package A: `grove` (Core SDK)
* **Purpose**: Lightweight, zero-overhead programmatic SDK for managing git worktree pools.
* **Dependencies**: `execa`, `proper-lockfile`, `zod`.
* **Binaries**: None.
* **Exported API**: `createGrove`, `Grove`, status types, error classes.

### Package B: `grove-cli` (Command-Line Tool)
* **Purpose**: User-facing command line wrapper.
* **Dependencies**: `grove` (workspace dependency), command-line parsers (e.g., `commander`), visual output formatting (e.g., `picocolors`, `cli-table3`).
* **Binaries**: `grove` executable.
* **Installation**: `pnpm add -g grove-cli` or run dynamically via `npx grove-cli`.

---

## 3. CLI Design & Subcommands

The CLI will act as a thin wrapper over the programmatic SDK APIs, resolving the configuration from local state or files.

### Subcommands

| CLI Command | SDK Target | Behavior |
| :--- | :--- | :--- |
| `grove acquire` | `grove.acquire()` | Allocates a slot and outputs the absolute directory path to `stdout`. |
| `grove release [path]` | `grove.release(path)` | Resets and detaches the worktree slot back to the pool. |
| `grove status` | `grove.list()` | Prints a formatted terminal table of all worktrees, PIDs, and states. |
| `grove destroy [path]` | `grove.destroy(path)` | Removes specified worktree slot from pool and disk. Supports `--force`. |
| `grove destroy-all` | `grove.destroyAll()` | Clears the entire pool on disk. Supports `--force`. |

---

## 4. CLI Configuration Resolution

Since the CLI is run out-of-context, it must determine the `repoRoot`, `groveRoot`, and other settings.

### Configuration Resolution Chain (in order of priority):
1. **CLI Flags**: Explicit overrides (e.g., `grove status --repo /path/to/repo`).
2. **Environment Variables**: Environment settings (e.g., `GROVE_REPO_ROOT`).
3. **Repository Discovery**: Traverse parent directories starting from the current working directory (`process.cwd()`) to find the closest `.git` folder boundary.
4. **Configuration File**: Locate a `.groverc.json` (or `.groverc.toml`) file in the discovered repository root for hook and `maxTrees` settings.

---

## 5. Migration Execution Strategy

To perform the migration without risking existing code stability, we will execute in four phases:

### Phase 1: Workspace Scaffolding
1. Create `pnpm-workspace.yaml`.
2. Move existing core files (excluding repository-level configurations) into `packages/grove/`.
3. Configure path references and verify `pnpm install` links dependencies correctly.
4. Verify existing tests pass within `packages/grove/`.

### Phase 2: CLI Package Setup
1. Create `packages/grove-cli/` directories and configurations.
2. Link the core `grove` package as a local workspace dependency.
3. Stub the main entrypoint and configure the binary field.

### Phase 3: CLI Implementation & Configuration Loader
1. Implement directory traversal for automatic Git repository root detection.
2. Implement `.groverc.json` loader for CLI configurations.
3. Write subcommand actions in `packages/grove-cli/src/commands/`.

### Phase 4: Verification & Release Prep
1. Write integration tests validating the binary's behavior via `execa` calls.
2. Ensure both packages build and check independently.
