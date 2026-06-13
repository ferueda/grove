---
name: grove
description: "Use Grove's lease-first git worktree pool CLI for durable branch-aware worktree leases: acquire, inspect, list, release, repair, destroy, and status. Use when agents or automation need isolated reusable checkouts without cloning repeatedly."
---

# Grove

Grove is a lease-first git worktree pool. It gives agents and automation durable, branch-aware checkouts keyed by `leaseId`.

## When to use

Use Grove when a task needs an isolated reusable worktree for a repo, especially across process restarts or concurrent jobs.

## Workflow

1. Start with `grove status --json` to inspect repo, pool, capacity, active leases, and suggestions.
2. Use `grove acquire --json --lease-id <id> --branch <branch> --create-from <ref>` for branch work, or `--ref <ref>` for detached validation work.
3. Run the caller's work in `lease.path`.
4. Release explicitly with `grove release --json --lease-id <id> --cleanup preserve|reset|quarantine`.
5. If a lease is stuck, follow `suggestions` or use `grove repair --json --lease-id <id> --action <action>`.

## Commands

**Always pass `--json` for agent automation.** JSON mode writes machine-readable output to stdout only; human prose goes to stderr.

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

Branch work — prefer a **new branch name** with `--create-from`:

```sh
grove acquire --json \
  --lease-id job_abc123 \
  --branch feature/my-work \
  --create-from main
```

Do **not** use `--branch main` to check out the existing `main` branch while your primary repo is already on `main`. Git allows a branch in only one worktree. Use `--create-from main` with a new branch name, or `--ref main` for detached work.

Detached validation:

```sh
grove acquire --json \
  --lease-id validate_abc123 \
  --ref origin/main
```

### Release

`--cleanup` is required:

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

## JSON errors

All failures with `--json` use a stable envelope on stdout:

```json
{ "ok": false, "error": { "code": "...", "message": "...", "details": {} } }
```

Read `error.details` before retrying. Common shapes:

**Missing required flags** (including Commander validation):

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_INPUT",
    "message": "required option '--cleanup <action>' not specified",
    "details": {
      "missing": ["cleanup"],
      "source": "commander",
      "commanderCode": "commander.missingMandatoryOptionValue"
    }
  }
}
```

**Missing acquire target:**

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_INPUT",
    "message": "Acquire requires either --branch or --ref",
    "details": { "missing": ["branch", "ref"], "requireOneOf": ["branch", "ref"] }
  }
}
```

**Lease conflict:**

```json
{
  "ok": false,
  "error": {
    "code": "LEASE_CONFLICT",
    "details": { "leaseId": "...", "existingBranch": "...", "requestedBranch": "..." }
  }
}
```

**Branch already checked out elsewhere:**

```json
{
  "ok": false,
  "error": {
    "code": "WORKTREE_IN_USE",
    "message": "Branch main is already checked out in another worktree",
    "details": {
      "branch": "main",
      "reason": "branch_already_checked_out",
      "existingWorktreePath": "/path/to/repo"
    }
  }
}
```

Invalid enum values include `details.allowed` (for example cleanup or repair actions).

## Tips

- Keep `GROVE_DIR` consistent across commands in the same session.
- Treat `leaseId` as the stable handle. Do not pass worktree paths to destructive commands.
- Follow `suggestions` when present — they recommend Grove-native next steps only.
- Use `grove status --json` or `grove list --json` to check pool capacity before acquiring.
- Use `grove commands --json` when you need machine-readable command discovery.
- Re-acquire with the same `leaseId` to get the same worktree back (idempotent for compatible targets).
- On `INVALID_INPUT`, inspect `details.missing` or `details.allowed` and retry with corrected flags.

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
