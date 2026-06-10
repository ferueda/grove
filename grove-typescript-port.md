# grove — TypeScript Port Plan

> **Status:** Planning  
> **Goal:** **grove** — standalone TypeScript SDK for managing git worktree pools programmatically.  
> **Strategy:** Mechanical parity with the Go implementation first; innovate only after tests prove equivalence.

---

## Table of Contents

1. [Context & Goals](#context--goals)
2. [What We Are Building](#what-we-are-building)
3. [What We Are Not Building (v0.1)](#what-we-are-not-building-v01)
4. [Architecture](#architecture)
5. [Repository Layout](#repository-layout)
6. [Tech Stack](#tech-stack)
7. [Public API](#public-api)
8. [Go → TypeScript Module Map](#go--typescript-module-map)
9. [Development & Testing Strategy](#development--testing-strategy)
10. [Phase 0 — Scaffold & Tooling](#phase-0--scaffold--tooling)
11. [Phase 1 — Git Layer](#phase-1--git-layer)
12. [Phase 2 — State & Locking](#phase-2--state--locking)
13. [Phase 3 — Process Detection & Termination](#phase-3--process-detection--termination)
14. [Phase 4 — Hooks](#phase-4--hooks)
15. [Phase 5 — Config](#phase-5--config)
16. [Phase 6 — Pool Core](#phase-6--pool-core)
17. [Phase 7 — Integration, Extensions & Parity Harness](#phase-7--integration-extensions--parity-harness)
18. [Phase 8 — Documentation & Publish Prep](#phase-8--documentation--publish-prep)
19. [Phase 9 — DaddyBot Integration (Downstream)](#phase-9--daddybot-integration-downstream)
20. [Phase 10 — Optional CLI (Later)](#phase-10--optional-cli-later)
21. [Risks & Mitigations](#risks--mitigations)
22. [Success Criteria](#success-criteria)
23. [Open Items (Deferred)](#open-items-deferred)

---

## Context & Goals

### Background

`grove` maintains a **pool of reusable git worktrees** per repository. Agents acquire an isolated, clean worktree instantly; when done, the worktree is reset and returned to the pool with dependencies and build cache intact.

The valuable core is not the CLI (subshell, prompts, self-updater) — it is the **pool allocator** in `internal/pool/`, backed by `internal/git/`, `internal/process/`, and `internal/hooks/`.

### Why TypeScript

- Embed in Node applications (e.g. DaddyBot lifecycle runner) without shelling out to a Go binary.
- Typed SDK with composable primitives (acquire, release, detect, terminate).
- Same `git` subprocess model as Go — no incomplete JS git libraries.

### Decisions (Locked)

| Decision                | Choice                                    | Rationale                                                                                                                                      |
| ----------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository              | **New standalone repo**                   | Clean package boundary; publishable npm module                                                                                                 |
| Go interop              | **Isolated**                              | Replacing Go CLI long-term; no shared state files                                                                                              |
| Port strategy           | **Faithful first**                        | Go behavior is the spec; parallel testing validates correctness                                                                                |
| Dev methodology         | **Test-first port**                       | Port Go tests per layer, then implement until green — not strict TDD, not implement-first                                                      |
| Consumer model          | **Generic library**                       | Expose tools; consumers decide terminate-on-release, fetch policy, etc.                                                                        |
| Process detection       | **Owner-PID + cwd scan**                  | Matches Go; both are required for correct in-use semantics                                                                                     |
| Termination             | **Separate API**                          | `release()` does not kill processes; callers compose                                                                                           |
| Config                  | **Programmatic only (v0.1)**              | SDK callers pass `createGrove({ ... })`; file loader deferred to optional CLI (Phase 10)                                                       |
| Tech stack              | **Node 24, tsgo, pnpm, ESM, vitest, oxc** | See [Tech Stack](#tech-stack)                                                                                                                  |
| **Product name**        | **grove**                                 | Repo `grove`, npm `grove`, CLI `grove` (Phase 10). Tagline: _a pool of reusable git worktrees_. Verify npm/GitHub availability before publish. |
| npm naming              | **`grove`**                               | Verified availability on npm                                                                                                                   |
| Module size             | **<700 LOC per file**                     | Split modules if a file grows; keeps code readable                                                                                            |
| Pool directory layout   | **`~/.grove/{repoName}-{hash}/`**         | Pool directory layout; see [Pool directory layout](#pool-directory-layout)                                                                     |
| Platform support (v0.1) | **macOS + Linux**                         | Windows out of scope; drops cwd-scan complexity on Win32                                                                                       |

### Downstream Consumer (Out of Scope for v0.1)

DaddyBot will consume this library via a thin `WorktreeBackend` adapter:

```
create  → grove.acquire()  → checkout_path
lifecycle → cwd = checkout_path
terminal  → grove.release() (+ optional terminate)
```

DaddyBot integration is **Phase 9** — only after the library passes its own parity tests.

---

## What We Are Building

The **grove** npm package provides:

| Capability            | Go source                         | Purpose                                                              |
| --------------------- | --------------------------------- | -------------------------------------------------------------------- |
| **Acquire**           | `pool.Acquire`                    | Get a clean, detached-HEAD worktree from pool or create new          |
| **Release**           | `pool.Release`                    | Reset worktree to default branch; clear owner reservation            |
| **List**              | `pool.List`                       | Status of all pool worktrees (available / in-use / dirty)            |
| **Destroy**           | `pool.Destroy`, `pool.DestroyAll` | Remove worktree from pool and disk                                   |
| **Git ops**           | `internal/git`                    | Subprocess wrapper for worktree add/remove/reset/fetch               |
| **State**             | `internal/pool/state`             | JSON persistence + cross-platform file lock                          |
| **Process detect**    | `internal/process/detect`         | cwd scan + owner-alive checks                                        |
| **Process terminate** | `internal/process/terminate`      | SIGTERM → SIGKILL on macOS + Linux (separate API)                    |
| **Hooks**             | `internal/hooks`                  | Shell commands at post-create / pre-destroy                          |
| **Config**            | `internal/config`                 | `resolveGroveDir()` only; hooks/maxTrees via `createGrove()` options |

---

## What We Are Not Building (v0.1)

| Excluded                 | Go source                      | Why                                                                            |
| ------------------------ | ------------------------------ | ------------------------------------------------------------------------------ |
| Subshell spawning        | `cmd/get.go`, `internal/shell` | CLI concern                                                                    |
| Interactive prompts      | `internal/ui`                  | Callers handle dirty-worktree UX                                               |
| Self-updater             | `internal/updater`             | CLI concern                                                                    |
| `EnsureGitignore`        | `internal/config/gitignore.go` | App-level concern                                                              |
| Library CLI              | `cmd/*`                        | Phase 10 (optional)                                                            |
| Config files (TOML/YAML) | `internal/config` TOML loader  | Programmatic `createGrove()` only; file loader at CLI boundary only (Phase 10) |
| npm git libraries        | —                              | Shell out to `git` on PATH via execa, same as Go                               |

---

## Architecture

### Pool Lifecycle

```
                    ┌─────────────────────────────────────┐
                    │              Grove                  │
                    │  (facade over pool + git + state)   │
                    └──────────────┬──────────────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          ▼                        ▼                        ▼
    ┌───────────┐           ┌────────────┐          ┌────────────┐
    │   git/    │           │   state/   │          │  process/  │
    │ subprocess│           │ JSON+lock  │          │ detect+kill│
    └───────────┘           └────────────┘          └────────────┘
```

### Acquire Flow (must match Go exactly)

```
acquire(repoRoot)
    │
    ├─ git.getDefaultBranch(repoRoot)
    ├─ git.fetch(repoRoot)          [if origin remote exists]
    │
    └─ withStateLock(groveDir):
           healState()
           for each worktree in pool:
               skip if destroying
               skip if ownerAlive()
               skip if process.isWorktreeInUse()
               skip if git.isDirty()
               → git.resetWorktree() + reserveOwner() → DONE
           if pool.length >= maxTrees → throw GroveExhausted
           else → git.addWorktree() + append state + reserveOwner()
    │
    └─ hooks.run(postCreate)        [OUTSIDE lock — critical]
```

### Release Flow

```
release(worktreePath)
    │
    ├─ withStateLock: reject if destroying
    ├─ git.resetWorktree(worktreePath, defaultBranch)
    └─ withStateLock: clear owner_pid, owner_started_at
```

**Note:** `release()` does **not** call `terminate()`. Callers that want CLI-parity behavior compose:

```typescript
await process.terminateInWorktree(path, { gracePeriod: 2000 });
await pool.release(path);
```

### Pool Directory Layout

This is what “pool dir naming” means — three levels of paths, not npm package naming:

| Piece              | Path                          | Example                                                            |
| ------------------ | ----------------------------- | ------------------------------------------------------------------ |
| **Default parent** | `~/.grove/`                   | Default parent directory for worktree pools                        |
| **Pool identity**  | `{repoBaseName}-{shortHash}/` | `myapp-a1b2c3/` — hash from `origin` URL, else absolute `repoRoot` |
| **Worktree slot**  | `{n}/{repoBaseName}/`         | `1/myapp/` — detached-HEAD checkout                                |

Full default path for repo `~/code/myapp`:

```
~/.grove/myapp-a1b2c3/
├── grove-state.json
├── grove-state.lock
├── 1/myapp/          ← first acquired worktree
├── 2/myapp/
└── ...
```

**Custom `groveRoot`**: pool lives at `{groveRoot}/.grove/{repoName}-{hash}/` under a custom root.

**Full override `groveDir`:** caller sets the exact pool path; skips `resolveGroveDir()` entirely.

- **shortHash:** first 6 hex chars of SHA-256.

### State Schema

```typescript
interface WorktreeEntry {
  name: string; // "1", "2", ...
  path: string; // absolute path to worktree checkout
  created_at: string; // ISO 8601
  destroying?: boolean;
  owner_pid?: number;
  owner_started_at?: number; // Unix ms — matches gopsutil CreateTime
}

interface GroveState {
  worktrees: WorktreeEntry[];
}
```

State file tracking the pool configuration and status.

---

## Repository Layout

```
grove/                                 # new standalone repo (github.com/…/grove)
├── package.json                       # see Tech Stack — ESM exports, deps, scripts
├── tsconfig.json                      # NodeNext, strict, ES2024
├── vitest.config.ts
├── pnpm-lock.yaml
├── README.md
├── LICENSE
├── .github/workflows/ci.yml         # ubuntu + macOS matrix
├── src/
│   ├── index.ts                     # public exports
│   ├── pool.ts                      # acquire, release, list, destroy
│   ├── state.ts                     # read/write state, withStateLock
│   ├── lock.ts                      # platform file locking
│   ├── git/
│   │   ├── index.ts
│   │   ├── run.ts                   # execFile wrapper
│   │   ├── branch.ts                # getDefaultBranch, branchRef
│   │   └── worktree.ts              # add, remove, reset, isDirty, fetch
│   ├── process/
│   │   ├── index.ts
│   │   ├── detect.ts                # findInWorktree, isInUse, ownerAlive
│   │   ├── terminate.ts             # terminateInWorktree
│   │   └── detect-unix.ts           # macOS + Linux cwd scan
│   ├── hooks.ts
│   ├── config.ts
│   ├── schemas.ts                 # Zod: GroveState, GroveConfig
│   └── errors.ts
├── test/                            # separate from src/ (publish-clean; matches DaddyBot)
│   ├── helpers/
│   │   ├── git-repo.ts              # setupRepo() — port of pool_test.go setupRepo
│   │   ├── shell-quote.ts           # quote paths for hook commands
│   │   └── hook-probe.mjs           # subprocess entry for lock/acquire-during-hook probes
│   ├── git.test.ts                  # ← new; maps git behaviors
│   ├── state.test.ts                # ← state.go + lock
│   ├── process.test.ts              # ← detect.go + terminate.go
│   ├── hooks.test.ts                # ← hooks.go (+ early hook cases before full pool)
│   ├── config.test.ts               # ← resolve_test.go
│   ├── pool.test.ts                 # ← pool_test.go (main parity; built in clusters Phase 6)
│   ├── grove.integration.test.ts    # vertical slice + cross-module smoke
│   └── parity/
│       └── compare-go.ts            # optional dev-only; not CI-gated
```

**Naming conventions:**

| Kind                | Convention                                     | Example                                                                                     |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Public API**      | TypeScript-native                              | `createGrove`, `Grove`, `GroveConfig`                                                       |
| **Internal `src/`** | Map to Go modules; split when >~200 LOC        | `pool.ts` ← `pool.go`, `git/branch.ts` ← `git.go`                                           |
| **Tests**           | `test/<module>.test.ts` mirrors Go `*_test.go` | `pool.test.ts` ← `pool_test.go`                                                             |
| **Test names**      | Keep Go test intent in `it(...)` labels        | `it('runs post_create hook in worktree', ...)` ← `TestAcquire_RunsPostCreateHookInWorktree` |
| **Platform**        | Suffix only where needed                       | `detect-unix.ts`; no `lock_unix.ts` (proper-lockfile)                                       |

Do **not** co-locate `*.test.ts` under `src/`. Do **not** mock `git` in pool/grove tests — use real git via `test/helpers/git-repo.ts`.

````

## Tech Stack

All choices locked for v0.1.

### Summary

| Layer | Choice | Notes |
|-------|--------|-------|
| **Runtime** | Node `>=24` | `engines` in package.json |
| **Language** | TypeScript (strict) | Public `.d.ts` required |
| **Validation** | Zod | `GroveState` on read; `GroveConfig` at `createGrove()` |
| **Package manager** | pnpm | `packageManager` field pinned (match DaddyBot: `pnpm@11.5.2`) |
| **Module format** | **ESM only** | `"type": "module"` — no CJS dual publish |
| **Compiler** | **tsgo** | `@typescript/native-preview`; `pnpm build` → `dist/` |
| **Test** | vitest | Real git repos in temp dirs; CI on ubuntu + macOS |
| **Lint / format** | oxlint + oxfmt | oxc toolchain; `oxlint . --deny-warnings` |
| **Subprocess** | execa | Git + hook shell invocations |
| **File lock** | proper-lockfile | Cross-platform exclusive lock on `grove-state.lock` |
| **Process cwd scan** | **Hand-rolled Unix (macOS + Linux)** | No npm dep; Windows out of scope for v0.1 |
| **System dep** | `git` on PATH | Documented requirement; not an npm dependency |

### Config: programmatic only

No TOML, YAML, or config-file loader in v0.1. Embedders pass everything to `createGrove()`:

```typescript
createGrove({
  repoRoot: '/path/to/repo',
  maxTrees: 8,
  groveRoot: '~/.my-app/groves',
  hooks: { postCreate: ['pnpm install'] },
});
````

`resolveGroveDir()` is exported for debugging; `groveRoot` maps to Go's `root` setting. A file loader belongs at the **CLI boundary only** (Phase 10), not in the library.

### Dependencies

**Runtime (`dependencies`):**

| Package           | Purpose                        |
| ----------------- | ------------------------------ |
| `zod`             | Config + state validation      |
| `execa`           | Git and hook subprocesses      |
| `proper-lockfile` | Pool state file exclusive lock |

**Dev (`devDependencies`):**

| Package                      | Purpose         |
| ---------------------------- | --------------- |
| `@typescript/native-preview` | tsgo compiler   |
| `@types/node`                | Node 24 typings |
| `vitest`                     | Test runner     |
| `oxlint`                     | Lint            |
| `oxfmt`                      | Format          |

**Explicitly excluded:** `@iarna/toml`, `simple-git`, `nodegit`, `isomorphic-git`, and any process-list npm package until hand-rolled detection fails in CI.

### Module format & exports

Best practice for a new Node 24 publishable library:

- ESM only — consumers `import { createGrove } from 'grove'`.
- Conditional `exports` with explicit `types` + `default` (no `"require"` condition).
- tsconfig `module` / `moduleResolution`: `"NodeNext"`.
- Source imports use **`.js` extensions** (NodeNext convention; emits `dist/*.js`).

### `package.json`

```json
{
  "name": "grove",
  "version": "0.0.0",
  "type": "module",
  "engines": { "node": ">=24" },
  "packageManager": "pnpm@11.5.2",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "types": "./dist/index.d.ts",
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsgo -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "oxlint . --deny-warnings",
    "format": "oxfmt --write .",
    "check": "pnpm lint && pnpm build && pnpm test",
    "prepublishOnly": "pnpm check"
  },
  "dependencies": {
    "execa": "^9.6.0",
    "proper-lockfile": "^4.0.0",
    "zod": "^4.4.0"
  },
  "devDependencies": {
    "@types/node": "^25.0.0",
    "@typescript/native-preview": "^7.0.0-dev",
    "oxfmt": "^0.54.0",
    "oxlint": "^1.69.0",
    "vitest": "^4.1.0"
  }
}
```

Version pins will be set to current at scaffold time; ranges above are illustrative.

### `tsconfig.json`

Align with DaddyBot (`daddybot/tsconfig.json`):

```json
{
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "esModuleInterop": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noUncheckedIndexedAccess": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "strict": true,
    "target": "ES2024",
    "verbatimModuleSyntax": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

### `vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000, // git subprocess tests can be slow
  },
});
```

Tests live in `test/` (not published). Vitest resolves TypeScript via its own pipeline; no separate `tsconfig.test.json` required for v0.1.

### CI (GitHub Actions)

- Matrix: `ubuntu-latest`, `macos-latest` (Windows not in scope for v0.1).
- Steps: `pnpm install` → `pnpm check`.
- `git` is pre-installed on all runners.

---

## Public API

### Primary: `createGrove()` + `Grove` interface

Use a factory as the main entry point (easier to mock in consumers) with a class implementation behind it:

```typescript
interface GroveConfig {
  /** Absolute path to the main git repository (pool key). */
  repoRoot: string;

  /** Override full grove (pool) directory path. Takes precedence over groveRoot. */
  groveDir?: string;

  /** Override grove parent dir (Go `root` equivalent). Default: ~/.grove/{repo}-{hash}. */
  groveRoot?: string;

  /** Max worktrees in pool. Default: 16. */
  maxTrees?: number;

  /** Lifecycle shell hooks. */
  hooks?: {
    postCreate?: string[];
    preDestroy?: string[];
  };

  /** Fetch origin before acquire. Default: true (matches Go). */
  fetchOnAcquire?: boolean;
}

/** Returned by acquire — path is the checkout; name is the pool slot id ("1", "2", ...). */
interface AcquiredSlot {
  readonly path: string;
  readonly name: string;
}

interface Grove {
  /** Acquire a clean worktree. Keeps owner reservation until release(). */
  acquire(): Promise<AcquiredSlot>;

  /** Reset worktree and return to pool. Does NOT kill processes. */
  release(worktreePath: string): Promise<void>;

  /** List all pool worktrees with status. */
  list(): Promise<WorktreeStatus[]>;

  /** Remove one worktree from pool. */
  destroy(worktreePath: string, options?: { force?: boolean }): Promise<void>;

  /** Remove all worktrees from pool. */
  destroyAll(options?: { force?: boolean }): Promise<void>;

  /** Look up a worktree entry by path. */
  findByPath(worktreePath: string): Promise<WorktreeEntry | null>;
}

/** Preferred constructor — validates config with Zod before returning a Grove instance. */
function createGrove(config: GroveConfig): Grove;
```

### Status types

```typescript
type WorktreeStatusLabel = "available" | "in-use" | "dirty" | "you're here";

interface WorktreeStatus {
  name: string;
  path: string;
  status: WorktreeStatusLabel;
  processes: ProcessInfo[];
}

interface ProcessInfo {
  pid: number;
  name: string;
}
```

### Process utilities (separate from pool)

```typescript
namespace process {
  /** Find processes whose cwd is inside worktreePath. */
  function findInWorktree(worktreePath: string): Promise<ProcessInfo[]>;

  /** True if any process has cwd inside worktree. */
  function isWorktreeInUse(worktreePath: string): Promise<boolean>;

  /**
   * Terminate processes in worktree (SIGTERM → grace → SIGKILL on Unix).
   * Filters out current process and ancestors.
   * Returns list of targeted processes.
   */
  function terminateInWorktree(
    worktreePath: string,
    options?: { gracePeriodMs?: number },
  ): Promise<ProcessInfo[]>;
}
```

### Config utility

```typescript
/**
 * Resolve default grove (pool) directory from repo root and optional grove-root override.
 * Used internally by createGrove() when groveDir is omitted; exported for debugging/doctor tools.
 */
function resolveGroveDir(repoRoot: string, groveRootOverride?: string): Promise<string>;
```

All other config (`maxTrees`, `hooks`, `groveDir`, `fetchOnAcquire`) is passed directly to `createGrove()` — no config files in v0.1.

### Errors (typed)

Each error carries a stable machine-readable `code` so downstream adapters (orchestrators, CLIs) can map to their own UX without parsing message strings:

```typescript
type GroveErrorCode =
  | 'GROVE_EXHAUSTED'
  | 'WORKTREE_DESTROYING'
  | 'WORKTREE_NOT_MANAGED'
  | 'WORKTREE_IN_USE'
  | 'GIT_NOT_FOUND'
  | 'GIT_COMMAND_FAILED'
  | 'INVALID_GROVE_STATE'
  | 'LOCK_FAILED';

class GroveError extends Error {
  readonly code: GroveErrorCode;
}

class GroveExhaustedError extends GroveError { ... }             // code: GROVE_EXHAUSTED
class WorktreeDestroyingError extends GroveError { ... }
class WorktreeNotManagedError extends GroveError { ... }
class GitNotFoundError extends GroveError { ... }
class GitCommandError extends GroveError { stderr: string; }
```

---

## Go → TypeScript Module Map

| Go file                          | TS file                       | Notes                                     |
| -------------------------------- | ----------------------------- | ----------------------------------------- |
| `internal/git/git.go`            | `src/git/*`                   | 1:1 function mapping                      |
| `internal/pool/state.go`         | `src/state.ts`, `src/lock.ts` | Rename state file                         |
| `internal/pool/lock_*.go`        | `src/lock.ts`                 | proper-lockfile (no custom lock files)    |
| `internal/pool/pool.go`          | `src/pool.ts`                 | Core logic                                |
| `internal/process/detect.go`     | `src/process/detect-unix.ts`  | macOS + Linux cwd scan                    |
| `internal/process/terminate*.go` | `src/process/terminate.ts`    | Unix only v0.1                            |
| `internal/hooks/hooks.go`        | `src/hooks.ts`                | `/bin/sh -c` (v0.1 targets Unix)          |
| `internal/hooks/command_*.go`    | inline in hooks.ts            |                                           |
| `internal/config/config.go`      | `src/config.ts`               | `resolveGroveDir` only (skip TOML loader) |
| `internal/pool/pool_test.go`     | `test/pool.test.ts`           | Behavioral port                           |

---

## Development & Testing Strategy

### Not strict TDD — test-first port

Go code + `*_test.go` **is the specification**. We do not invent requirements in tests.

**Per layer, repeat:**

1. **Port tests** — translate Go test cases into vitest (`test/<module>.test.ts`).
2. **Stub implementation** — exports exist; failing or `throw new Error('not implemented')`.
3. **Implement** — minimum code to go green.
4. **Refactor** — only when the current test cluster is green.

This is **test-first port**, not greenfield TDD and not implement-first.

### Layer order (bottom-up)

```
git.test.ts           → src/git/*
state.test.ts       → src/state.ts, src/lock.ts
process.test.ts       → src/process/*
hooks.test.ts         → src/hooks.ts
config.test.ts        → src/config.ts
pool.test.ts          → src/pool.ts, createGrove()     (in clusters — see Phase 6)
grove.integration.test.ts  → cross-module smoke
```

Phases 1–5 can overlap slightly (e.g. git + state), but **do not start Phase 6 until Phases 1–5 tests are green**.

### What to port / skip

| Go tests                          | grove                     | Notes                                                |
| --------------------------------- | ------------------------- | ---------------------------------------------------- |
| `internal/pool/pool_test.go`      | `test/pool.test.ts`       | **Primary parity gate** — port in clusters (Phase 6) |
| `internal/config/resolve_test.go` | `test/config.test.ts`     | Phase 5                                              |
| `internal/config/hooks_test.go`   | Skip                      | No file loader in v0.1                               |
| `internal/hooks/hooks_test.go`    | Partial → `hooks.test.ts` | Unit hook runner; rest covered by pool tests         |
| `cmd/e2e_test.go`                 | **Skip**                  | Subshell CLI — not the SDK                           |
| `internal/process/*_test.go`      | `test/process.test.ts`    | Port behaviors                                       |

### What not to do

- **Do not mock git** in pool or integration tests.
- **Do not port all of `pool.test.ts` in one PR** — use clusters (Phase 6).
- **Do not extend tests** with grove-specific cases (Zod, error `code`) until the ported Go behavior in that cluster is green.
- **Do not write DaddyBot integration tests** until Phase 7 is complete.
- **Do not CI-gate** optional `compare-go.ts`.

### Subprocess hook probes

Go runs hook probes via `os.Args[0] -test.run=TestHookLockProbe -- ...`. grove uses a dedicated script so child processes do not need tsgo:

- `test/helpers/hook-probe.mjs` — small ESM script; invoked as `node test/helpers/hook-probe.mjs <command> ...args`.
- Commands: `lock-probe`, `acquire-during-hook`, `supersede-destroy` (maps Go probe tests).
- `test/helpers/shell-quote.ts` — quote temp paths for `/bin/sh -c` hook strings.

Scaffold in Phase 0; used heavily in Phase 6 pool clusters.

### When to add grove-specific tests (Phase 7)

After Phase 6 clusters are green, add tests that have **no Go equivalent**:

- `INVALID_GROVE_STATE` from corrupt `grove-state.json`
- `GROVE_EXHAUSTED` stable `code`
- `createGrove({ groveRoot })` resolution without files
- Parallel acquire from two processes (lock stress)

### Parity matrix (Phase 8 README)

Each row = one ported `it(...)` or cluster from `pool.test.ts` / other test files. Status: **ported** | **intentional diff** | **n/a**.

---

## Phase 0 — Scaffold & Tooling

**Goal:** Empty repo that builds, lints, and runs tests in CI.

### Step 0.1 — Create repository

- [x] Initialize `grove` standalone repo.
- [x] Copy scaffold from [Tech Stack](#tech-stack): `package.json`, `tsconfig.json`, `vitest.config.ts`.
- [x] Runtime deps: `zod`, `execa`, `proper-lockfile`.
- [x] Dev deps: `@typescript/native-preview`, `@types/node`, `vitest`, `oxlint`, `oxfmt`.
- [x] `src/index.ts` — empty public export stub.
- [x] `.gitignore`: `dist/`, `node_modules/`, `coverage/`.
- [x] `pnpm build` → `dist/index.js` + `dist/index.d.ts`.

**Why:** Establish publishing contract (ESM exports, Node 24, typed dist) before writing logic.

### Step 0.2 — CI matrix

- [x] `.github/workflows/ci.yml`: `pnpm check` on ubuntu + macOS.
- [x] Pin pnpm via `packageManager` + `corepack enable` in workflow.

**Why:** File locking and process cwd detection must be validated on macOS (symlink paths) and Linux.

### Step 0.3 — Test harness skeleton

- [x] `test/helpers/git-repo.ts` — port `setupRepo()` from `pool_test.go`:
  - Create temp dir (symlink-resolve on macOS).
  - Init bare remote + local clone with `origin`.
  - Initial commit pushed to `main`.
  - Return `{ repoDir, groveDir }` (test-isolated grove path).
- [x] `test/helpers/shell-quote.ts` — port `quoteForShell()` from `pool_test.go`.
- [x] `test/helpers/hook-probe.mjs` — subprocess entry for lock/hook-race probes (stub commands OK until Phase 6).

**Why:** Every subsequent test depends on this fixture; hook probes need a plain `node` child, not tsgo.

### Step 0.4 — Error types + Zod schemas stub

- [x] `src/errors.ts` with base `GroveError`, subclasses, and stable `code` fields.
- [x] `src/schemas.ts` — Zod schemas for `GroveState`, `WorktreeEntry`, `GroveConfig`.

**Why:** Consistent error surface from day one; corrupt state files fail with `INVALID_GROVE_STATE` instead of silent misbehavior.

**Phase 0 exit criteria:** `pnpm test` runs (zero or stub tests OK); `pnpm check` green on ubuntu + macOS.

---

## Phase 1 — Git Layer

**Goal:** Faithful port of `internal/git/git.go` — all git operations via subprocess.

**Approach:** Test-first port. Create `test/git.test.ts` with cases below **before** implementing each function group. Use `setupRepo()` from helpers.

### Step 1.0 — Port `test/git.test.ts` skeleton

- [x] Create `test/git.test.ts` with `describe` blocks matching Steps 1.1–1.4 test cases (all failing initially).
- [x] No mocks — real `git` subprocess against `setupRepo()` fixture.

### Step 1.1 — `runGit` wrapper

**What:** `src/git/run.ts`

```typescript
async function runGit(cwd: string | undefined, args: string[]): Promise<string>;
```

**How:**

- `execa('git', args, { cwd })`.
- Trim stdout; on failure, map stderr into `GitCommandError`.
- Verify `git` exists on first call; throw `GitNotFoundError` if missing.

**Why:** Single choke point for all git I/O — matches Go `runGit`; execa gives cleaner cross-platform subprocess errors.

**Test:** Run `git --version` and `git rev-parse` in temp repo.

### Step 1.2 — Repo root & default branch

**What:** Port these functions:

| Function                     | Go                 |
| ---------------------------- | ------------------ |
| `findRepoRoot()`             | `FindRepoRoot`     |
| `findRepoRootFrom(dir)`      | `FindRepoRootFrom` |
| `getDefaultBranch(repoRoot)` | `GetDefaultBranch` |
| `hasRemote(repoRoot, name)`  | `HasRemote`        |
| `getRemoteUrl(repoRoot)`     | `GetRemoteURL`     |
| `shortHash(input)`           | `ShortHash`        |

**How — `getDefaultBranch`:** Resolve main repo via `--git-common-dir` when inside worktree (same logic as Go lines 19–32). Try `symbolic-ref refs/remotes/origin/HEAD` → local `HEAD` → `config init.defaultBranch`.

**Why:** Default branch resolution is non-trivial inside worktrees; must match Go for reset correctness.

**Test:** Default branch in plain repo; default branch when called from a worktree checkout.

### Step 1.3 — Branch ref selection

**What:** Port `branchRef(repoRoot, branch)` and `isAncestor(repoRoot, a, b)`.

**How:**

- If both local and `origin/<branch>` exist, compare ancestry via `git merge-base --is-ancestor`.
- Prefer remote when local is ancestor of remote.
- Prefer local when remote is ancestor of local.
- On divergence, prefer `origin/<branch>`.

**Why:** This determines what commit detached worktrees reset to — core pool behavior.

**Test:** Cases: only local, only remote, local ahead, remote ahead, diverged.

### Step 1.4 — Worktree operations

**What:** Port:

| Function                              | Go command                                                 |
| ------------------------------------- | ---------------------------------------------------------- |
| `addWorktree(repoRoot, path, branch)` | `worktree add --detach <path> <ref>`                       |
| `removeWorktree(repoRoot, path)`      | `worktree remove --force <path>`                           |
| `resetWorktree(path, branch)`         | `checkout --detach --force` → `reset --hard` → `clean -fd` |
| `detachWorktree(path)`                | `checkout --detach`                                        |
| `isDirty(path)`                       | `status --porcelain` (non-empty = dirty)                   |
| `fetch(repoRoot)`                     | `fetch origin` (no-op if no origin)                        |

**Why:** `resetWorktree` is called on every acquire (reuse) and release — must be exact.

**Test:**

- Add worktree → verify detached HEAD at correct commit.
- Modify file → `isDirty` true → `resetWorktree` → `isDirty` false.
- Remove worktree → directory gone.

**Phase 1 exit criteria:** `pnpm test test/git.test.ts` green; all git functions exported from `src/git/index.ts`.

---

## Phase 2 — State & Locking

**Goal:** JSON persistence with exclusive cross-platform file lock.

**Approach:** Test-first port. Create `test/state.test.ts` before implementing `src/state.ts` and `src/lock.ts`.

### Step 2.0 — Port `test/state.test.ts` skeleton

- [x] Cases for Steps 2.1–2.3 (round-trip, missing file, invalid Zod shape, lock exclusivity, healState).
- [x] Lock exclusivity test spawns child running `hook-probe.mjs lock-probe` (port `TestHookLockProbe` intent).

### Step 2.1 — State read/write

**What:** `src/state.ts`

| Function                      | Behavior                                                       |
| ----------------------------- | -------------------------------------------------------------- |
| `readState(groveDir)`         | Read `grove-state.json`; return `{ worktrees: [] }` if missing |
| `writeState(groveDir, state)` | `JSON.stringify` indented, mode `0644`                         |
| `stateFilePath(groveDir)`     | `join(groveDir, 'grove-state.json')`                           |

**How (read path):** Parse JSON → validate with Zod `GroveStateSchema` → return typed state. Invalid shape throws `INVALID_GROVE_STATE`.

**Why:** Matches Go `ReadState` / `WriteState`; Zod catches hand-edited or partially written state before it corrupts pool logic.

**Test:** Round-trip; missing file returns empty state; corrupt JSON throws; invalid shape (missing `path`) throws `INVALID_GROVE_STATE`.

### Step 2.2 — File lock

**What:** `src/lock.ts` with `withStateLock(groveDir, fn)`.

**How:**

1. `mkdir(groveDir, { recursive: true })`.
2. Lock file path: `join(groveDir, 'grove-state.lock')`.
3. Use **proper-lockfile** `lockSync` / `unlockSync` (or async variants) around `fn()`.
4. On lock timeout → throw `LOCK_FAILED`.

**Why:** All pool mutations must be serialized — acquire, release, destroy, list all use this. proper-lockfile handles Unix `flock` and Windows `LockFileEx` without custom build tags.

**Test:** Covered in `test/state.test.ts` — while lock held in child (`hook-probe.mjs lock-probe`), parent cannot acquire lock.

### Step 2.3 — `healState`

**What:** Port `healState(state)`:

- Drop entries where `path` does not exist on disk.
- If `owner_pid` set but `ownerAlive()` false → clear owner fields and `destroying`.

**Why:** Self-healing after crash — stale reservations must not permanently block pool.

**Test:** Inject dead PID into state → heal clears it.

**Phase 2 exit criteria:** `pnpm test test/state.test.ts` green on ubuntu + macOS.

---

## Phase 3 — Process Detection & Termination

**Goal:** Port `internal/process/detect.go` and `internal/process/terminate*.go`.

**Approach:** Test-first port. Create `test/process.test.ts` before `src/process/*`.

### Step 3.0 — Port `test/process.test.ts` skeleton

- [x] ownerAlive / reserveOwner / startedAt cases.
- [x] findInWorktree / isWorktreeInUse — spawn child with `cwd` in worktree (use `execa` + `sleep` in `setupRepo` worktree path).
- [x] terminateInWorktree — spawn `sleep`, terminate, assert gone.

### Step 3.1 — `ownerAlive` / `reserveOwner`

**What:** In `src/process/detect.ts`:

```typescript
function ownerAlive(entry: WorktreeEntry): Promise<boolean>;
function reserveOwner(entry: WorktreeEntry): Promise<void>; // sets pid + startedAt
function startedAt(pid: number): Promise<number | null>; // process create time ms
```

**How:**

- `reserveOwner`: set `owner_pid = process.pid`, `owner_started_at = startedAt(pid)`.
- `ownerAlive`: PID exists AND `startedAt(pid) === entry.owner_started_at`.

**Why:** Prevents PID reuse false positives; core acquire exclusion.

**Test:** Reserve → alive. Kill process → not alive. Reuse PID (hard to test; trust start time check).

### Step 3.2 — `findInWorktree` / `isWorktreeInUse`

**What:** Scan all processes; return those whose cwd is inside `worktreePath`.

**Strategy:** Hand-roll Unix only — **no npm process-list dependency**. Port Go's `internal/process/detect.go` logic. Windows is out of scope for v0.1 (owner-PID + dirty checks still work there; cwd scan returns `[]` or is skipped).

**How (Linux):** Read `/proc/{pid}/cwd` symlinks for each PID.

**How (macOS):** `ps -eo pid` + `lsof -a -d cwd -p {pid}`; resolve symlinks before compare (`/private/var` vs `/var`).

**Comparison logic:**

- `resolvePath()` both worktree and cwd (symlink-expand).
- `relative(worktree, cwd)` does not start with `..` → process is inside worktree.

**Why:** Go uses gopsutil cwd scan on every acquire attempt. Without this, pool can hand out worktrees with running agents inside.

**Test:** Spawn child with `cwd = worktreePath` → `isWorktreeInUse` true. Change cwd → false. Run on ubuntu + macOS CI.

### Step 3.3 — `terminateInWorktree`

**What:** Port `TerminateWorktreeProcesses`.

**How:**

1. `findInWorktree(path)`.
2. Filter out current PID and ancestor chain (matches Go `filterProtectedProcesses`).
3. Unix: SIGTERM → wait `gracePeriod` → SIGKILL survivors.
4. Windows: out of scope v0.1 (no-op or skip in `process.platform` guard).

**Why:** Exposed as separate API — callers (future CLI, tests, DaddyBot) decide when to use it. Not part of `release()`.

**Test:** Spawn sleep process in worktree → terminate → process gone.

**Phase 3 exit criteria:** `pnpm test test/process.test.ts` green on ubuntu + macOS.

---

## Phase 4 — Hooks

**Goal:** Port `internal/hooks/hooks.go`.

**Approach:** Test-first port. `test/hooks.test.ts` for the hook **runner** in isolation (not full acquire flow — that is Phase 6).

### Step 4.0 — Port `test/hooks.test.ts`

- [x] Sequential commands run in `workDir`.
- [x] First command fails (nonexistent binary) → second still runs.
- [x] Failures do not throw from `runHooks()`.

### Step 4.1 — `runHooks(commands, workDir, { stdout, stderr })`

**What:** Run shell commands sequentially in `workDir`.

**How:**

- Unix: `/bin/sh -c <command>`.
- Windows: `%COMSPEC% /d /s /c <command>`.
- On failure: log to stderr, **continue** with next command.
- Failures do **not** throw — matches Go.

**Why:** `post_create` runs dependency install (`pnpm install`); failures must not block acquire.

**Note:** Hook-during-acquire tests live in `test/pool.test.ts` (Phase 6), not here.

**Phase 4 exit criteria:** `pnpm test test/hooks.test.ts` green.

---

## Phase 5 — Config

**Goal:** Pool directory resolution only.

**Approach:** Test-first port. Port `internal/config/resolve_test.go` → `test/config.test.ts` before `src/config.ts`.

### Step 5.0 — Port `test/config.test.ts`

- [x] `resolveGroveDir` empty root → under `$HOME/.grove/{repo}-*`
- [x] Relative `groveRoot` → under `{repo}/{groveRoot}/.grove/...`
- [x] Absolute `groveRoot`
- [x] Env var expansion (`$TEST_GROVE_ROOT`)

### Step 5.1 — `resolveGroveDir`

**What:** Port `config.ResolvePoolDir` (renamed for grove branding).

**How:**

1. `hashInput = getRemoteUrl(repoRoot)` or `repoRoot` on failure.
2. `poolName = basename(repoRoot) + '-' + shortHash(hashInput)`.
3. If `groveRootOverride` empty → `~/.grove/{poolName}`.
4. If relative → `join(repoRoot, expandEnv(override), '.grove', poolName)`.
5. If absolute → `join(expandEnv(override), '.grove', poolName)`.

**How `createGrove()` uses it:** When `config.groveDir` is omitted, call `resolveGroveDir(repoRoot, config.groveRoot)`.

**Why:** Deterministic pool identity per repo — same repo always maps to same grove. Everything else (`maxTrees`, `hooks`) is constructor args — no file I/O.

**Phase 5 exit criteria:** `pnpm test test/config.test.ts` green.

---

## Phase 6 — Pool Core

**Goal:** Port `internal/pool/pool.go` + `createGrove()` — test-first, **one cluster at a time**.

**Approach:** Do **not** implement the full pool then port `pool_test.go`. For each cluster below: (1) add `it(...)` cases to `test/pool.test.ts`, (2) implement minimum in `src/pool.ts` + `src/index.ts` (`createGrove`), (3) green before next cluster.

Wire `createGrove()` early in Cluster A — validates config → `resolveGroveDir` → pool instance.

### Step 6.0 — Vertical slice smoke (`test/grove.integration.test.ts`)

**Before full pool clusters** — prove modules wire together:

- [x] Add failing test: `createGrove({ repoRoot, groveDir: temp })` → `acquire()` → path exists on disk → `release()` → re-`acquire()` is clean.
- [x] Implement thinnest `createGrove` + minimal `acquire`/`release` (new slot only; reuse logic can come in Cluster A).
- [x] `pnpm test test/grove.integration.test.ts` green.

**Why:** Catches integration mistakes before investing in hook-race tests.

---

### Step 6.1 — Cluster A: Happy path

**Port tests first** (`test/pool.test.ts`):

| Go test                                              | `it(...)` intent                                  |
| ---------------------------------------------------- | ------------------------------------------------- |
| — (integration)                                      | acquire returns `AcquiredSlot` with detached HEAD |
| —                                                    | acquire → modify → release → re-acquire is clean  |
| `TestRelease_DoesNotDependOnCurrentWorkingDirectory` | release works when parent cwd is elsewhere        |

**Then implement:** `acquire` (scan + create path), `release`, `findByPath`; `fetch` on acquire; owner reservation; basic state append. [x]

**Green gate:** Cluster A tests pass. [x]

---

### Step 6.2 — Cluster B: Hooks on acquire

**Port tests first:**

| Go test                                                    | `it(...)` intent                                         |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| `TestAcquire_RunsPostCreateHookInWorktree`                 | hook creates sentinel in worktree                        |
| `TestAcquire_HookFailureDoesNotFailAcquire`                | failed hook does not fail acquire                        |
| `TestAcquire_RunsPostCreateHookAfterReleasingStateLock`    | `hook-probe.mjs lock-probe` during post_create           |
| `TestAcquire_DoesNotReuseWorktreeReservedByPostCreateHook` | `hook-probe.mjs acquire-during-hook` gets different path |

**Then implement:** post_create outside lock; hook invocation via `runHooks`. [x]

**Green gate:** Cluster B tests pass. [x]

---

### Step 6.3 — Cluster C: List & heal

**Port tests first:**

| Go test                                                            | `it(...)` intent              |
| ------------------------------------------------------------------ | ----------------------------- |
| `TestList_ShowsReservedWorktreeAsInUse`                            | reserved slot → `in-use`      |
| `TestList_RecoversDestroyingWorktreeWhenOwnerIsGone`               | stale destroy cleared on list |
| `TestList_RecoversDestroyingWorktreeWhenOwnerIdentityDoesNotMatch` | PID mismatch cleared on list  |

**Then implement:** `list()`, `healState` on list, status labels.

**Green gate:** Cluster C tests pass.

---

### Step 6.4 — Cluster D: Destroy

**Port tests first:**

| Go test                                                            | `it(...)` intent                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------ |
| `TestDestroy_RunsPreDestroyHook`                                   | pre_destroy runs before removal                        |
| `TestDestroy_NonForceRejectsReservedWorktree`                      | non-force rejects in-use                               |
| `TestDestroy_DoesNotAllowHookAcquireToReusePendingDestroyWorktree` | acquire during pre_destroy cannot take destroying slot |
| `TestDestroy_PreservesSupersededReservationAfterHook`              | `hook-probe.mjs supersede-destroy`                     |
| `TestDestroyAll_PreservesWorktreeAcquiredByHook`                   | destroyAll + hook acquire race                         |
| `TestDestroyAll_PreservesSupersededReservationAfterHook`           | same supersede for destroyAll                          |
| `TestDestroyAll_NonForceRejectsReservedWorktree`                   | in-use guard                                           |
| `TestDestroyAll_NonForceRejectsLiveDestroyingWorktree`             | live destroying guard                                  |
| `TestRelease_RejectsDestroyingWorktree`                            | release on destroying slot fails                       |

**Then implement:** `destroy`, `destroyAll`, `sameDestroyReservation`, pre_destroy outside lock.

**Green gate:** Cluster D tests pass.

---

### Step 6.5 — Cluster E: Exhaustion & reuse

**Port tests first:**

| Go test | `it(...)` intent                                            |
| ------- | ----------------------------------------------------------- |
| —       | fill `maxTrees` → `GroveExhaustedError` / `GROVE_EXHAUSTED` |
| —       | dirty worktree skipped; clean reused slot reset on acquire  |
| —       | `ownerAlive` + cwd scan skip in-use slots                   |

**Then implement:** pool exhaustion error, acquire scan loop (dirty, in-use, destroying, owner), reuse + `resetWorktree`.

**Green gate:** Cluster E tests pass.

---

### Step 6.6 — `createGrove` facade

- [x] `createGrove(config)` — Zod-validate `GroveConfig`, resolve `groveDir`, return `Grove` instance.
- [x] Export from `src/index.ts` only public API.

**Phase 6 exit criteria:** `pnpm test test/pool.test.ts test/grove.integration.test.ts` green on ubuntu + macOS. All `pool_test.go` behaviors covered across clusters A–E.

---

## Phase 7 — Integration, Extensions & Parity Harness

**Goal:** Grove-specific tests (no Go equivalent) + optional dev parity tool. **Prerequisite:** Phase 6 green.

**Approach:** Extend only after parity clusters pass — these tests document intentional additions, not port gaps.

### Step 7.0 — Grove-specific tests (`test/grove.integration.test.ts` extend)

Add cases with **no Go equivalent**:

- [x] Invalid `grove-state.json` on disk → `readState` / acquire surfaces `INVALID_GROVE_STATE`.
- [x] `GroveExhaustedError.code === 'GROVE_EXHAUSTED'`.
- [x] `createGrove({ repoRoot, maxTrees, hooks, groveRoot })` — no config files on disk.
- [x] Acquire → modify (dirty) → `release()` still hard-resets (no force flag).
- [x] Heal drops state entry when worktree directory deleted from disk.
- [x] Two parallel `acquire()` from child processes — no double-booking (file lock stress).

### Step 7.1 — Optional parity validation

Verify integration behavior and robustness.

**Phase 7 exit criteria:** Extension tests green; parity matrix complete; full `pnpm test` green on ubuntu + macOS CI.

---

## Phase 8 — Documentation & Publish Prep

### Step 8.1 — README

Cover:

- What the library does (pool semantics, not CLI).
- Requirements (`git` on PATH, Node 24+).
- Quick start (`createGrove()` with programmatic config).
- Tagline: _grove — a pool of reusable git worktrees_.
- API overview (`acquire` → `AcquiredSlot`, `release`, `list`, `destroy`, process utils).
- Pool directory layout.
- Hooks (passed via `createGrove({ hooks })`; shell trust model documented).
- Error types and stable `code` fields.
- Platform support: macOS + Linux (v0.1).

### Step 8.2 — API docs

- TSDoc on all public exports.
- Consider typedoc generation in CI (optional).

### Step 8.3 — CHANGELOG + LICENSE

- MIT license.
- Initial version `0.1.0`.

### Step 8.4 — Publish checklist

- [x] `files` field in package.json (`dist`, README, LICENSE).
- [x] `prepublishOnly`: build + test.
- [x] Engine: `"node": ">=24"`.

**Phase 8 exit criteria:** README quick start works copy-paste; package builds clean tarball.

---

## Phase 9 — DaddyBot Integration (Downstream)

> **Prerequisite:** Phase 7 complete (all tests green, parity matrix drafted); library published or linked via `file:`.

This phase lives in the DaddyBot repo, not `grove`.

### Step 9.1 — `WorktreeBackend` interface

```typescript
interface WorktreeBackend {
  provision(repoPath: string): Promise<{ checkoutPath: string }>;
  teardown(checkoutPath: string): Promise<void>;
}
```

### Step 9.2 — Implementation

DaddyBot adapter is thin — it maps config → `createGrove()`, owns branch naming, and composes terminate + release:

```typescript
class GroveBackend implements WorktreeBackend {
  async provision(repoPath) {
    const grove = createGrove({ repoRoot: repoPath, ...fromDaddybotYaml });
    const { path: checkoutPath, name } = await grove.acquire();
    // DaddyBot checks out branch after acquire (grove stays detached-HEAD):
    // git checkout -b daddybot/{workUnitId}
    return { checkoutPath };
  }

  async teardown(checkoutPath) {
    // DaddyBot chooses policy — library only provides the primitives:
    await process.terminateInWorktree(checkoutPath, { gracePeriodMs: 2000 });
    await grove.release(checkoutPath);
  }
}
```

Map library `error.code` → orchestrator errors at the adapter boundary (e.g. `GROVE_EXHAUSTED` → consumer-specific blocked state). The library does not know DaddyBot exit codes.

### Step 9.3 — Wire into DaddyBot

| File                                    | Change                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/config.ts`                         | `checkout_mode: 'worktree'` + `worktree` block (`backend: grove`, max_trees, grove_root, post_create) |
| `src/work-units.ts`                     | `createWorkUnit()` calls `provision()`; expose `checkout_path` on status                              |
| `src/worktree/effective-checkout.ts`    | `effectiveCheckoutPath(status) = checkout_path ?? repo_path`                                          |
| `src/lifecycle/build-invocation.ts`     | worker `cwd` via effective checkout                                                                   |
| `src/lifecycle/run-worker-stage.ts`     | snapshots, diffs, checkpoints on effective path                                                       |
| `src/lifecycle/run-validation-stage.ts` | validation `cwd` on effective path                                                                    |
| `src/lifecycle/run-decision-stage.ts`   | head SHA from effective path                                                                          |
| `src/lifecycle/worker-guards.ts`        | worktree-aware clean rules                                                                            |
| `src/preflight.ts`                      | light pool availability check when worktree mode enabled                                              |
| `src/db.ts`                             | persist `checkout_path` at insert (v1: insert-only)                                                   |

### Step 9.4 — DaddyBot tests

- Default `checkout_mode: current_branch` — all existing tests pass unchanged.
- Worktree mode integration test with real git pool in temp dir (one full lifecycle loop).
- Mock `Grove` interface for adapter unit tests.
- Grove exhausted → adapter maps `GROVE_EXHAUSTED` to orchestrator blocked state.
- Hold slot on `blocked` / `needs_human`; release only on terminal states (orchestrator policy, not library).

**Phase 9 exit criteria:** DaddyBot `make check-full` green; worktree mode runs full lifecycle in `checkout_path`.

---

## Phase 10 — Optional CLI (Later)

Only after library is stable. Thin wrapper over SDK:

| Command                | Maps to                         |
| ---------------------- | ------------------------------- |
| `grove acquire`        | `grove.acquire()` + print path  |
| `grove release [path]` | `terminate` + `grove.release()` |
| `grove status`         | `grove.list()`                  |
| `grove destroy`        | `grove.destroy()`               |

May add TOML `loadConfig()` at CLI boundary only; library stays programmatic.

---

## Risks & Mitigations

| Risk                           | Impact               | Mitigation                                                        |
| ------------------------------ | -------------------- | ----------------------------------------------------------------- |
| Windows unsupported (v0.1)     | No cwd scan on Win32 | Document macOS + Linux only; owner-PID still works cross-platform |
| File lock differences          | Pool corruption      | Test `withStateLock` on all platforms; port Go lock probe test    |
| Git not on PATH                | Runtime failure      | `GitNotFoundError` on first use; document requirement             |
| Hook command injection         | Security             | Hooks are user-configured (same as Go); document trust model      |
| Grove exhaustion               | Consumer blocked     | `GroveExhaustedError` with actionable message                     |
| Crash leaves owner reservation | Slot appears in-use  | `healState` on every list/acquire                                 |
| Parallel acquire race          | Double booking       | File lock serializes all mutations                                |
| macOS symlink paths            | cwd mismatch         | `resolvePath` before comparison (port Go)                         |

---

## Success Criteria

### Library (v0.1)

- [x] All `pool_test.go` behaviors ported in Phase 6 clusters A–E and passing.
- [x] Phase 7 extension tests passing.
- [x] CI green: ubuntu + macOS (`pnpm check`).
- [x] `acquire` returns `AcquiredSlot`; `release` / `list` / `destroy` / `destroyAll` match Go semantics.
- [x] `post_create` runs outside state lock.
- [x] `release()` does not terminate processes.
- [x] `terminateInWorktree()` available as separate API.
- [x] Errors expose stable `code` fields.
- [x] State file validated with Zod on read.
- [x] Programmatic `createGrove()` works without any files.
- [x] No config-file dependency in v0.1.
- [x] Tech stack as documented: Node 24, ESM, tsgo, pnpm, vitest, oxc, execa, proper-lockfile, zod.
- [x] README quick start is copy-pasteable; parity matrix documents Go equivalence.

### DaddyBot (Phase 9)

- [ ] `checkout_mode: worktree` runs lifecycle in `checkout_path`.
- [ ] Default mode unchanged — zero regression.
- [ ] `checkout_path` exposed in status JSON.
- [ ] Pool exhaustion surfaces as `lifecycle_blocked`.

---

## Open Items (Deferred)

| Item                          | Notes                                                               |
| ----------------------------- | ------------------------------------------------------------------- |
| npm name `grove` availability | Verify on npmjs.com + GitHub before publish; fallback: `@org/grove` |
| Config files                  | Phase 10 CLI only (if ever); library stays programmatic             |
| Windows support               | Out of scope v0.1; add later if needed                              |
| Go parity harness in CI       | Dev-only initially                                                  |
| `EnsureGitignore` utility     | Add if CLI phase needs it                                           |
| Branch-out experiments        | After parity proven: custom fetch policies, lease tokens, metrics   |

---

## Suggested Implementation Order (Summary)

```
Phase 0  Scaffold + test helpers     → pnpm check green; git-repo, hook-probe.mjs
Phase 1  Git (test-first)            → test/git.test.ts green
Phase 2  State + lock (test-first)   → test/state.test.ts green
Phase 3  Process (test-first)        → test/process.test.ts green
Phase 4  Hooks (test-first)          → test/hooks.test.ts green
Phase 5  Config (test-first)         → test/config.test.ts green
Phase 6  Pool (test-first, clusters) → 6.0 vertical slice → A → B → C → D → E
Phase 7  Extensions + parity matrix  → grove-specific tests; optional compare-go
Phase 8  Docs + Publish              → shippable v0.1
Phase 9  DaddyBot                    → downstream integration
Phase 10 CLI (optional)              → `grove` CLI
```

**Rhythm per phase:** port tests → stub → implement → green → next.

Phases 1–5 can partially overlap (git + state). **Phase 6.0 waits for 1–5.** **Phase 6 clusters wait for 6.0.** **Phase 7 waits for 6.**

Estimated scope: ~800 LOC source + ~600 LOC tests — comparable to Go SDK-relevant code.

---

## Appendix: DaddyBot handoff review (cherry-picks only)

Reviewed `daddybot/dev/plans/worktree-library-handoff.md` for ideas that strengthen **this** plan without changing its core decisions. Items **incorporated** above:

| Idea                                      | Where added                                       |
| ----------------------------------------- | ------------------------------------------------- |
| `AcquiredSlot { path, name }`             | Public API, Phase 6                               |
| `createGrove()` factory                   | Public API                                        |
| `execa` for subprocesses                  | Tooling, Phase 1                                  |
| Zod validation at boundaries              | Phase 0, Phase 2, schemas                         |
| Stable error `code` fields                | Errors section, tests, Phase 9 adapter note       |
| Parity matrix in README                   | Phase 8                                           |
| Upstream credit + npm naming warning      | Decisions, Phase 8                                |
| <700 LOC per file                         | Decisions                                         |
| Test-first port methodology               | Development & Testing Strategy; all phases        |
| Pool test clusters A–E                    | Phase 6                                           |
| Grove-specific extension tests            | Phase 7                                           |
| hook-probe.mjs subprocess helpers         | Phase 0, Phase 6                                  |
| Richer DaddyBot file list for Phase 9     | Phase 9 (reference only — lives in DaddyBot repo) |
| `effectiveCheckoutPath()` helper location | Phase 9                                           |
| Hold slot on blocked; terminal release    | Phase 9 (orchestrator policy)                     |

Items **not adopted** (handoff differs; our plan unchanged):

| Handoff suggestion                       | Our plan keeps                                             |
| ---------------------------------------- | ---------------------------------------------------------- |
| Owner-PID only v1; skip Windows cwd scan | Unix cwd scan (macOS + Linux); Windows out of scope v0.1   |
| Defer `terminate` to v2                  | `terminateInWorktree()` in v0.1 as separate API            |
| TOML config loader                       | Programmatic `createGrove()` only in v0.1                  |
| `release({ force })` on pool API         | `release()` always resets (Go `pool.Release` has no force) |
| `pool-state.json` filename               | `grove-state.json`                                         |
| Node >=24, tsgo, oxlint                  | Locked — see Tech Stack                                    |
| Flatter single-file modules (`git.ts`)   | Split `git/`, `process/` dirs until size requires merge    |
