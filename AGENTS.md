# AGENTS.md

Felipe owns this. Work style: telegraph; noun-phrases ok; drop grammar; min tokens; always respond in English.

## Project Overview

`Grove` is a standalone TypeScript SDK (+ CLI) for managing git worktree pools programmatically.

**Core Mission:** Provide a robust and reliable git worktree pool implementation.

**What it does:**

- **Acquire (ephemeral):** Instantly allocate clean, detached-HEAD git worktrees.
- **Acquire (lease):** Durable branch-aware reservations with stable `leaseId`, idempotent re-acquire, and persisted state.
- **Release:** Reset and return worktrees to the pool (ephemeral) or apply cleanup policy (`preserve` / `reset` / `quarantine`) for leases.
- **Protect:** Serialize state updates with file locks; prevent allocating or destructively cleaning in-use directories via PID reservations and CWD scans.

**Architecture:**

- Node.js (`>=24`), ESM-only (`type: "module"`).
- Monorepo: `@ferueda/grove` (SDK), `@ferueda/grove-cli` (CLI).
- `zod` for boundary validation.
- `execa` for Git subprocesses.
- `proper-lockfile` for cross-platform file locking.

## Agent Protocol

- **Port Strategy:** Go behavior is spec for ephemeral pool. Lease mode spec: `packages/grove/test/lease.integration.test.ts`. Use **test-first port** (port tests to vitest, run, fail, then implement until green).
- **Module Size:** Split files if they grow >700 LOC.
- **Mocks:** DO NOT mock `git` in pool/integration tests. Use `setupRepo()` from `packages/grove/test/helpers/git-repo.ts`.
- **Config:** Programmatic `createGrove()` config only; no config files (TOML/YAML) loader.
- **Errors:** Throw explicit subclassed errors from `packages/grove/src/errors.ts` with stable `code` properties (e.g. `GROVE_EXHAUSTED`, `LEASE_CONFLICT`, `UNSAFE_CLEANUP`).

### Naming Conventions

- Variables, functions, methods: `camelCase`
- Types, Interfaces, Classes: `PascalCase`
- Files/Folders: `kebab-case`

### General Engineering Rules

- **Rule 1 — Simplicity First:** Minimum code that solves the problem. Match existing Go style for ephemeral pool. Don't add speculative features.
- **Rule 2 — Surgical Changes:** Touch only what you must. If you modify core pool logic, run `vitest` immediately.
- **Rule 3 — Validation at Boundaries:** Use `zod` to validate `GroveConfig` input and `GroveState` from disk. Once parsed, operate on trusted shapes. `leaseId` must match `LeaseIdSchema` regex.
- **Rule 4 — Read before you write:** Ephemeral pool → Go port plan. Lease mode → `lease.integration.test.ts`.

## Commit & Release Guidelines

- **Branching:** All feature work on branches; merge via PR to `main`. No direct push to `main`.
- **Commit Formatting:** Strict Conventional Commits (`feat:`, `fix:`, `refactor:`, `build:`, `ci:`, `chore:`, `docs:`, `style:`, `test:`).
- **Automated Versioning:** Do NOT run `pnpm version` or changesets. CI uses `release-please` for semver bumps. Publishing on Release PR merge.
- Keep commits atomic and scoped.
- E.g.: `feat: implement lease acquire with branch creation`

## Core Commands

- **Install:** `corepack enable && pnpm install`
- **Lint:** `pnpm lint`
- **Format:** `pnpm format`
- **Test:** `pnpm test` (vitest)
- **Build:** `pnpm build`
- **Typecheck:** `pnpm typecheck`
- **All Checks:** `pnpm check`

## Key Source Locations

| Area | Path |
|------|------|
| Pool + lease logic | `packages/grove/src/pool.ts` |
| Lease queries | `packages/grove/src/queries.ts` |
| Schemas / config | `packages/grove/src/schemas.ts` |
| Types | `packages/grove/src/types.ts` |
| Errors | `packages/grove/src/errors.ts` |
| CLI commands | `packages/grove-cli/src/commands/` |
| Lease integration tests | `packages/grove/test/lease.integration.test.ts` |

## Source of Truth Docs

- Product Vision: `VISION.md`
- User-facing API docs: `README.md`
