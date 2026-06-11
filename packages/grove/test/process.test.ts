import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { startedAt, ownerAlive, reserveOwner, findInWorktree } from "../src/process/detect.js";
import { terminateWorktreeProcesses } from "../src/process/terminate.js";
import type { WorktreeEntry } from "../src/schemas.js";
import { execa } from "execa";
import { mkdir, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

describe("Process Detection & Termination", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "grove-test-process-"));
    // Expand tmpDir to realpath to match CWD logic natively
    tmpDir = await realpath(tmpDir);
  });

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  describe("Liveness & Reservation", () => {
    it("startedAt returns number for current process", async () => {
      const ms = await startedAt(process.pid);
      expect(typeof ms).toBe("number");
      expect(ms).toBeGreaterThan(0);
    });

    it("startedAt returns null for non-existent process", async () => {
      // Very high PID unlikely to exist
      const ms = await startedAt(999999);
      expect(ms).toBeNull();
    });

    it("reserveOwner sets pid and started_at correctly", async () => {
      const entry: WorktreeEntry = {
        name: "test",
        path: "/test",
        created_at: new Date().toISOString(),
      };
      await reserveOwner(entry);
      expect(entry.owner_pid).toBe(process.pid);
      expect(entry.owner_started_at).toBeTypeOf("number");
    });

    it("ownerAlive returns true for current process reservation", async () => {
      const entry: WorktreeEntry = {
        name: "test",
        path: "/test",
        created_at: new Date().toISOString(),
      };
      await reserveOwner(entry);
      const alive = await ownerAlive(entry);
      expect(alive).toBe(true);
    });

    it("ownerAlive returns false for dead process", async () => {
      const entry: WorktreeEntry = {
        name: "test",
        path: "/test",
        created_at: new Date().toISOString(),
        owner_pid: 999999,
        owner_started_at: 123456789,
      };
      const alive = await ownerAlive(entry);
      expect(alive).toBe(false);
    });
  });

  describe("findInWorktree & terminateWorktreeProcesses", () => {
    it("finds process running inside worktree", async () => {
      const worktreePath = join(tmpDir, "wt1");
      await mkdir(worktreePath, { recursive: true });

      // Spawn child in worktree
      const child = execa("node", ["-e", "setTimeout(() => {}, 60000)"], { cwd: worktreePath });

      // Wait for child to initialize
      await new Promise((r) => setTimeout(r, 500));

      const { processes } = await findInWorktree(worktreePath);
      expect(processes.length).toBeGreaterThanOrEqual(1);
      expect(processes.map((p: any) => p.PID)).toContain(child.pid);

      child.kill();
      await child.catch(() => {});
    });

    it("terminates processes gracefully", async () => {
      const worktreePath = join(tmpDir, "wt2");
      await mkdir(worktreePath, { recursive: true });

      // Spawn child in worktree that ignores SIGTERM to force SIGKILL
      const child = execa(
        "node",
        [
          "-e",
          `
        process.on('SIGTERM', () => { console.log('ignored'); });
        setTimeout(() => {}, 60000);
      `,
        ],
        { cwd: worktreePath },
      );

      await new Promise((r) => setTimeout(r, 500));

      const targeted = await terminateWorktreeProcesses(worktreePath, 100);
      expect(targeted.map((p) => p.PID)).toContain(child.pid);

      // Verify child is dead
      await expect(child).rejects.toThrow(/Command was killed/);

      const { processes: procsAfter } = await findInWorktree(worktreePath);
      expect(procsAfter.map((p: any) => p.PID)).not.toContain(child.pid);
    });
  });
});
