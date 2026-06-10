# AGENTS.md

Felipe owns this. Work style: telegraph; noun-phrases ok; drop grammar; min tokens; always respond in English.

## Project Overview

`grove` is a standalone TypeScript SDK for managing git worktree pools programmatically.

**Core Mission:** Provide a robust and reliable git worktree pool implementation.

**What it does:**

- **Acquire:** Instantly allocate clean, detached-HEAD git worktrees.
- **Release:** Reset and return worktrees to the pool without destroying dependencies.
- **Protect:** Serialize state updates with file locks and prevent allocating in-use directories by scanning active process PIDs and CWDs.

**Architecture:**

- Node.js (`>=24`), ESM-only (`type: "module"`).
- `zod` for boundary validation.
- `execa` for Git subprocesses.
- `proper-lockfile` for cross-platform file locking.

## Agent Protocol

- **Port Strategy:** The Go behavior is the spec. Use **test-first port** (port Go tests to vitest, run, fail, then implement until green).
- **Module Size:** Split files if they grow >700 LOC.
- **Mocks:** DO NOT mock `git` in pool/integration tests. Use the `setupRepo()` helper from `test/helpers/git-repo.ts` to spin up real bare repos.
- **Dependencies:** Install deps with `pnpm install`.
- **Config:** Programmatic `createGrove()` config only; no config files (TOML/YAML) loader for v0.1.
- **Errors:** Throw explicit subclassed errors from `src/errors.ts` using stable `code` properties (e.g. `GROVE_EXHAUSTED`).

### Naming Conventions

- Variables, functions, methods: `camelCase`
- Types, Interfaces, Classes: `PascalCase`
- Files/Folders: `kebab-case`

### General Engineering Rules

- **Rule 1 — Simplicity First:** Minimum code that solves the problem. Match existing Go style where possible. Don't add speculative features.
- **Rule 2 — Surgical Changes:** Touch only what you must. If you modify core pool logic, run `vitest` immediately.
- **Rule 3 — Validation at Boundaries:** Use `zod` to validate `GroveConfig` input and `GroveState` from disk. Once parsed, operate on trusted shapes.
- **Rule 4 — Read before you write:** If you are porting a behavior, read the `grove-typescript-port.md` plan to ensure it's in scope for v0.1.

## Commit Guidelines

- Review `git diff` before commit.
- Keep commits atomic and scoped.
- Use conventional commit prefixes (`feat|fix|refactor|build|ci|chore|docs|style|test`).
- E.g.: `feat: implement findInWorktree cwd scan`

## Core Commands

- **Install:** `corepack enable && pnpm install`
- **Lint:** `pnpm lint`
- **Format:** `pnpm format`
- **Test:** `pnpm test` (runs vitest)
- **Build:** `pnpm build`
- **Typecheck:** `pnpm typecheck`
- **All Checks:** `pnpm check` (runs lint, typecheck, build, test)

## Source of Truth Docs

- Project Plan & Port Strategy: `grove-typescript-port.md`
- Product Vision: `VISION.md`
