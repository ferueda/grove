# Grove TypeScript vs Go Parity Matrix

This document outlines the level of mechanical parity achieved between the original `treehouse` Go implementation and this `grove` TypeScript port.

## Goal

The primary goal of the v0.1 port was exact mechanical equivalence to the Go `pool_test.go` and `internal/pool` behaviors.

## Core Features

| Feature                       | Go (`treehouse`)                                                   | TypeScript (`grove`)                                                  | Parity Status | Notes                                                                         |
| ----------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------- |
| **Pool Directory Hashing**    | SHA-256 of absolute repo path, fallback to `.treehouse` in home    | SHA-256 of absolute repo path, fallback to `.grove` in `os.homedir()` | ✅ 1:1        | TS uses `crypto.createHash('sha256')`. Renamed `.treehouse` to `.grove`.      |
| **State Synchronization**     | `proper-lockfile` (or similar file locking)                        | `proper-lockfile`                                                     | ✅ 1:1        | Uses cross-platform file locking (`grove-state.lock`).                        |
| **Process Liveness Scan**     | `gopsutil` cross-platform                                          | `ps` / `lsof` (macOS/Linux)                                           | ⚠️ Partial    | Windows not supported in v0.1 of TS. CWD scan works via native OS commands.   |
| **Acquire (Checkout)**        | `git worktree add`                                                 | `git worktree add`                                                    | ✅ 1:1        | Clean checkout on the default branch.                                         |
| **Release (Cleanup)**         | Hard reset, clean untracked, submodules                            | Hard reset, clean untracked, submodules                               | ✅ 1:1        | Fully mimics `treehouse return`.                                              |
| **Heal (Orphan Recovery)**    | Drops state entries if dir is deleted, clears owner if PID is dead | Same                                                                  | ✅ 1:1        | Tested extensively in `test/grove.integration.test.ts`.                       |
| **Double-booking Prevention** | Serialized state + PID/CWD scan                                    | Serialized state + PID/CWD scan                                       | ✅ 1:1        | TS adds a stress test for parallel acquires.                                  |
| **Lifecycle Hooks**           | Configured in `treehouse.toml`                                     | Programmatic config arrays                                            | ⚠️ Partial    | TS does not load TOML files in v0.1; configured via `createGrove({ hooks })`. |

## Known Deviations

- **Configuration Layer:** The Go CLI parses a `treehouse.toml` file. The TypeScript `grove` SDK is designed to be consumed programmatically by other tools (e.g. CLI wrappers), so configuration is passed directly to `createGrove()` rather than parsed from disk.
- **Cross-Platform:** Go `gopsutil` handles Windows smoothly. TS uses shell commands (`lsof`, `ps`) which restrict CWD scanning to Unix-like systems.
