import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupPathFixture } from "./helpers/git-repo.js";
import { readState, writeState, healState } from "../src/state.js";
import { withStateLock } from "../src/lock.js";
import type { GroveState } from "../src/schemas.js";
import { InvalidGroveStateError, LockFailedError } from "../src/errors.js";
import { rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { fileURLToPath } from "node:url";

describe("State & Locking", () => {
  let tmpDir: string;
  let groveDir: string;

  beforeEach(async () => {
    const setup = await setupPathFixture();
    tmpDir = setup.tmpDir;
    groveDir = setup.groveDir;
  });

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  describe("readState / writeState", () => {
    it("returns empty state if file missing", async () => {
      const state = await readState(groveDir);
      expect(state.worktrees).toEqual([]);
    });

    it("round-trips state cleanly", async () => {
      await mkdir(groveDir, { recursive: true });
      const s: GroveState = {
        worktrees: [{ name: "1", path: join(tmpDir, "1"), created_at: new Date().toISOString() }],
      };
      await writeState(groveDir, s);
      const read = await readState(groveDir);
      expect(read.worktrees).toHaveLength(1);
      expect(read.worktrees[0]?.name).toBe("1");
    });

    it("throws INVALID_GROVE_STATE on corrupt JSON", async () => {
      await mkdir(groveDir, { recursive: true });
      await writeFile(join(groveDir, "grove-state.json"), "{ bad json");
      await expect(readState(groveDir)).rejects.toThrowError(InvalidGroveStateError);
    });

    it("throws INVALID_GROVE_STATE on invalid Zod shape", async () => {
      await mkdir(groveDir, { recursive: true });
      await writeFile(
        join(groveDir, "grove-state.json"),
        JSON.stringify({ worktrees: [{ bad: 1 }] }),
      );
      await expect(readState(groveDir)).rejects.toThrowError(InvalidGroveStateError);
    });
  });

  describe("withStateLock", () => {
    it("executes callback with lock", async () => {
      let run = false;
      await withStateLock(groveDir, async () => {
        run = true;
      });
      expect(run).toBe(true);
    });

    it("throws LockFailedError if lock is held by another process", async () => {
      const probePath = fileURLToPath(new URL("./helpers/hook-probe.mjs", import.meta.url));

      const child = execa("node", [probePath, "lock-probe", groveDir]);

      // Wait for child to initialize and grab the lock
      await new Promise((r) => setTimeout(r, 500));

      await expect(withStateLock(groveDir, async () => {}, { retries: 1 })).rejects.toThrowError(
        LockFailedError,
      );

      child.kill();
      // wait for child to die to prevent ECOMPROMISED errors from proper-lockfile on directory deletion
      await child.catch(() => {});
    });
  });

  describe("healState", () => {
    it("drops entries with missing paths", async () => {
      const state: GroveState = {
        worktrees: [
          { name: "1", path: join(tmpDir, "does-not-exist"), created_at: new Date().toISOString() },
        ],
      };
      const healed = await healState(state);
      expect(healed.worktrees).toHaveLength(0);
    });

    it("clears dead owner fields", async () => {
      const existingPath = join(tmpDir, "exists");
      await mkdir(existingPath, { recursive: true });
      const state: GroveState = {
        worktrees: [
          {
            name: "1",
            path: existingPath,
            created_at: new Date().toISOString(),
            owner_pid: -1, // Stub treats -1 as dead
            owner_started_at: 1234,
            destroying: true,
            state: "available",
          },
        ],
      };
      const healed = await healState(state);
      expect(healed.worktrees).toHaveLength(1);
      expect(healed.worktrees[0]?.owner_pid).toBeUndefined();
      expect(healed.worktrees[0]?.owner_started_at).toBeUndefined();
      expect(healed.worktrees[0]?.destroying).toBeUndefined();
    });

    it("migrates legacy entries to available state", async () => {
      const existingPath = join(tmpDir, "exists-legacy");
      await mkdir(existingPath, { recursive: true });
      const state = {
        worktrees: [
          {
            name: "legacy",
            path: existingPath,
            created_at: new Date().toISOString(),
          },
        ],
      } as unknown as GroveState;

      const healed = await healState(state);
      expect(healed.worktrees).toHaveLength(1);
      expect(healed.worktrees[0]?.state).toBe("available");
      expect(healed.worktrees[0]?.name).toBe("legacy");
    });
  });
});
