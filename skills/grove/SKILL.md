---
name: grove
description: "Use Grove's lease-first git worktree pool CLI for durable branch-aware worktree leases: acquire, inspect, list, release, repair, destroy, and status. Use when agents or automation need isolated reusable checkouts without cloning repeatedly."
user-invocable: false
author: Felipe Rueda (ferueda)
metadata:
  hermes:
    tags: [git, worktree, cli, leases, automation, agents]
    category: devtools
---

# Grove

Grove is a lease-first git worktree pool. It gives agents and automation durable, branch-aware checkouts keyed by `leaseId`.

Grove is **not** an agent runner, workflow manager, PR system, or validation framework. Use it only to manage checkout leases.

## Install the skill

```sh
npx skills add ferueda/grove --skill grove -g
```

## When to use

Use Grove when a task needs an isolated reusable worktree for a repo, especially across process restarts or concurrent jobs.

Do **not** use Grove to:

- Run agents or orchestrate multi-step workflows
- Open PRs, run reviews, or validate output
- Replace your caller's lifecycle management

## Workflow

1. Start with `grove status --json` to inspect repo, pool, capacity, active leases, and suggestions.
2. Use `grove acquire --json --lease-id <id> --branch <branch> --create-from <ref>` for branch work, or `--ref <ref>` for detached validation work.
3. Run the caller's work in `lease.path`.
4. Release explicitly with `grove release --json --lease-id <id> --cleanup preserve|reset|quarantine`.
5. If a lease is stuck, follow `suggestions` or use `grove repair --json --lease-id <id> --action <action>`.

## Commands

Prefer `--json` for agent automation. JSON mode writes machine-readable output to stdout only; human prose goes to stderr.

| Command | Purpose |
|---------|---------|
| `grove status --json` | Pool dashboard: repo, capacity, leases, suggestions |
| `grove acquire --json` | Acquire or re-acquire a lease-backed worktree |
| `grove inspect --json` | Full details for one lease |
| `grove list --json` | All leases with pool aggregates |
| `grove release --json` | Release with cleanup policy |
| `grove repair --json` | Recover stuck leases |
| `grove destroy --json` | Remove a lease and its worktree |
| `grove commands --json` | Machine-readable command catalog |

### Discovery

```sh
grove commands --json   # list all commands with usage hints
grove status --json    # pool dashboard (start here)
```

### Acquire

Branch work (creates branch from ref):

```sh
grove acquire --json \
  --lease-id job_abc123 \
  --branch feature/my-work \
  --create-from main
```

Detached validation:

```sh
grove acquire --json \
  --lease-id validate_abc123 \
  --ref origin/main
```

### Inspect and list

```sh
grove inspect --json --lease-id job_abc123
grove list --json
```

`list --json` includes `count`, `byState`, `pool` (used/max/available), and `suggestions`.

### Release

```sh
grove release --json --lease-id job_abc123 --cleanup preserve
grove release --json --lease-id job_abc123 --cleanup reset --reset-to origin/main
grove release --json --lease-id job_abc123 --cleanup quarantine
```

### Repair

```sh
grove repair --json --lease-id job_abc123 --action resume-acquire
grove repair --json --lease-id job_abc123 --action resume-cleanup
grove repair --json --lease-id job_abc123 --action force-destroy --force
```

### Destroy

```sh
grove destroy --json --lease-id job_abc123
grove destroy --json --lease-id job_abc123 --force
```

## JSON response shapes

Success responses include the primary payload (`lease`, `leases`, or `result`) plus optional additive fields:

- `suggestions` — advisory next Grove commands with reasons
- `count`, `byState`, `pool` — on `list --json` and `status --json`

Error responses:

```json
{
  "ok": false,
  "error": {
    "code": "LEASE_CONFLICT",
    "message": "...",
    "details": { "leaseId": "...", "existingBranch": "...", "requestedBranch": "..." }
  }
}
```

Recoverable errors include structured `details` to help callers decide the next action without extra inspection.

## Tips

- Keep `GROVE_DIR` consistent across commands in the same session.
- Treat `leaseId` as the stable handle. Do not pass worktree paths to destructive commands.
- Follow `suggestions` when present — they recommend Grove-native next steps only.
- Use `grove status --json` or `grove list --json` to check pool capacity before acquiring.
- Use `grove commands --json` when you need machine-readable command discovery.
- Re-acquire with the same `leaseId` to get the same worktree back (idempotent for compatible targets).

## Environment

| Variable | Purpose |
|----------|---------|
| `GROVE_DIR` | Override pool directory (must be consistent) |
| `GROVE_REPO_ROOT` | Override repository root detection |

## Scope boundaries

Grove manages git worktree leases. Your caller owns:

- What runs inside `lease.path`
- When to release or destroy
- PR creation, CI, reviews, and validation
- Workflow orchestration across multiple tools
