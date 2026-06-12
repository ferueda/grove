# AGENTS.md

Felipe owns this. Work style: telegraph; noun-phrases ok; drop grammar; min tokens; always respond in English.

## Project Overview

`Grove` is a standalone TypeScript SDK (+ CLI) for managing git worktree pools programmatically.

**Core Mission:** Provide a robust and reliable lease-first git worktree pool implementation.

**What it does:**

- **Acquire (lease):** Durable branch-aware reservations with stable `leaseId`, idempotent re-acquire, and persisted state.
- **Release:** Apply cleanup policy (`preserve` / `reset` / `quarantine`) with write-ahead `releasing` state.
- **Destroy:** Path-safe, process-safe removal with crash-resumable `destroying` state.
- **Repair:** Explicit recovery (`quarantine`, `resume-acquire`, `resume-cleanup`, `force-destroy`).
- **Protect:** Serialize state updates with file locks; prevent destructive cleanup in-use via PID reservations and CWD scans.

**Architecture:**

- Node.js (`>=24`), ESM-only (`type: "module"`).
- Monorepo: `@ferueda/grove` (SDK), `@ferueda/grove-cli` (CLI).
- `zod` for boundary validation.
- `execa` for Git subprocesses.
- `proper-lockfile` for cross-platform file locking.

## Agent Protocol

- **Spec:** Lease integration tests in `packages/grove/test/lease-*.integration.test.ts` (acquire, hooks, release, repair, destroy). Use **test-first** for behavior changes.
- **Module Size:** Split files if they grow >700 LOC.
- **Mocks:** DO NOT mock `git` in pool/integration tests. Use `setupRepo()` from `packages/grove/test/helpers/git-repo.ts`.
- **CLI tests:** Seed pool state via SDK (`packages/grove-cli/test/helpers/seed-lease.ts`) when exercising `list`, `release`, or error envelopes; keep full `dist/cli.js` subprocess paths for acquire happy path, acquire errors, branch reuse, and human mode.
- **Config:** Programmatic `createGrove()` config only; no config files (TOML/YAML) loader.
- **Errors:** Throw explicit subclassed errors from `packages/grove/src/errors.ts` with stable `code` properties.
- **State changes:** Route lease/slot mutations through `packages/grove/src/transitions.ts` — no direct `.state =` in mutator modules.

### Naming Conventions

- Variables, functions, methods: `camelCase`
- Types, Interfaces, Classes: `PascalCase`
- Files/Folders: `kebab-case`

### General Engineering Rules

- **Rule 1 — Simplicity First:** Minimum code that solves the problem. Don't add speculative features.
- **Rule 2 — Surgical Changes:** Touch only what you must. If you modify core pool logic, run `vitest` immediately.
- **Rule 3 — Validation at Boundaries:** Use `zod` to validate `GroveConfig` input and `GroveState` from disk. `leaseId` must match `LeaseIdSchema` regex.
- **Rule 4 — Read before you write:** Lease behavior → `lease-*.integration.test.ts` buckets under `packages/grove/test/`. Transition rules → `transitions.test.ts`.

## Commit & Release Guidelines

- **Branching:** All feature work on branches; merge via PR to `main`. No direct push to `main`.
- **Commit Formatting:** Strict Conventional Commits (`feat:`, `fix:`, `refactor:`, `build:`, `ci:`, `chore:`, `docs:`, `style:`, `test:`).
- **Automated Versioning:** Do NOT run `pnpm version` or changesets. CI uses `release-please` for semver bumps.
- Keep commits atomic and scoped.

## Core Commands

- **Install:** `corepack enable && pnpm install`
- **Lint:** `pnpm lint`
- **Format:** `pnpm format`
- **Test:** `pnpm test` (vitest)
- **Build:** `pnpm build`
- **Typecheck:** `pnpm typecheck`
- **All Checks:** `pnpm check` or `make check`

## Key Source Locations

| Area | Path |
|------|------|
| Pool facade | `packages/grove/src/pool.ts` |
| Acquire | `packages/grove/src/lease-acquire.ts` |
| Release | `packages/grove/src/lease-release.ts` |
| Destroy | `packages/grove/src/lease-destroy.ts` |
| Repair | `packages/grove/src/lease-repair.ts` |
| Transitions | `packages/grove/src/transitions.ts` |
| Schemas / config | `packages/grove/src/schemas.ts` |
| Errors | `packages/grove/src/errors.ts` |
| CLI commands | `packages/grove-cli/src/commands/` |
| Lease integration tests | `packages/grove/test/lease-{acquire,hooks,release,repair,destroy}.integration.test.ts` |
| CLI JSON tests | `packages/grove-cli/test/cli.test.ts` |

## Source of Truth Docs

- Product Vision: `VISION.md`
- User-facing API docs: `README.md`
- v1 implementation plan: `grove-v1-lease-first-implementation-plan.md`
