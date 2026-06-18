import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupPathFixture, setupRepo } from "./helpers/git-repo.js";
import {
  migrateLegacyToLeaseFirst,
  parseLeaseFirstState,
  readLeaseFirstState,
  writeLeaseFirstState,
} from "../src/state-v1.js";
import {
  GroveLeaseSchema,
  type GroveState,
  type LeaseFirstGroveState,
} from "../src/schemas.js";
import { InvalidGroveStateError } from "../src/errors.js";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { healPoolState, findOrAllocateSlot, loadPoolState } from "../src/pool-state.js";
import { createTestGrove } from "./helpers/test-grove.js";

const NOW = "2026-06-11T00:00:00.000Z";

describe("Lease-first state", () => {
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

  describe("parseLeaseFirstState", () => {
    it("parses native lease-first state and enforces joint invariants", () => {
      const state: LeaseFirstGroveState = {
        slots: [
          {
            slotName: "slot-1",
            path: "/pool/slot-1",
            state: "leased",
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        leases: [
          {
            leaseId: "job-1",
            slotName: "slot-1",
            path: "/pool/slot-1",
            repoRoot: "/repo",
            state: "leased",
            target: {
              mode: "detached",
              requestedRef: "main",
              resolvedRefSha: "abc123",
            },
            acquiredHeadSha: "abc123",
            currentHeadSha: "abc123",
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
      };

      const parsed = parseLeaseFirstState(state);
      expect(parsed.leases).toHaveLength(1);
      expect(parsed.slots[0]?.state).toBe("leased");
    });

    it("migrates legacy worktrees state", () => {
      const legacy: GroveState = {
        worktrees: [
          {
            name: "slot-1",
            path: "/pool/slot-1",
            created_at: NOW,
            leaseId: "job-1",
            branch: "agent/job-1",
            baseRef: "origin/main",
            baseSha: "abc123",
            acquiredHeadSha: "abc123",
            currentHeadSha: "abc123",
            state: "leased",
          },
        ],
      };

      const migrated = migrateLegacyToLeaseFirst(legacy, { repoRoot: "/repo" });
      expect(migrated.slots).toHaveLength(1);
      expect(migrated.leases).toHaveLength(1);
      expect(migrated.leases[0]?.target?.mode).toBe("branch");
      expect(parseLeaseFirstState(legacy, { repoRoot: "/repo" }).leases[0]?.repoRoot).toBe(
        "/repo",
      );
    });

    it("throws INVALID_GROVE_STATE when legacy pendingCleanup is invalid", () => {
      const legacy: GroveState = {
        worktrees: [
          {
            name: "slot-1",
            path: "/pool/slot-1",
            created_at: NOW,
            leaseId: "job-1",
            branch: "agent/job-1",
            baseRef: "origin/main",
            baseSha: "abc123",
            acquiredHeadSha: "abc123",
            currentHeadSha: "abc123",
            state: "quarantined",
            pendingCleanup: { cleanup: "reset" },
          },
        ],
      };

      expect(() => migrateLegacyToLeaseFirst(legacy, { repoRoot: "/repo" })).toThrowError(
        InvalidGroveStateError,
      );
      expect(() => parseLeaseFirstState(legacy, { repoRoot: "/repo" })).toThrowError(
        /Invalid legacy pendingCleanup/,
      );
    });

    it("rejects reset cleanup without resetTo in lease-first state", () => {
      const result = GroveLeaseSchema.safeParse({
        leaseId: "job-1",
        slotName: "slot-1",
        path: "/pool/slot-1",
        repoRoot: "/repo",
        state: "releasing",
        pendingCleanup: { cleanup: "reset" },
        createdAt: NOW,
        updatedAt: NOW,
      });
      expect(result.success).toBe(false);
    });

    it("rejects leased record without head identity", () => {
      const result = GroveLeaseSchema.safeParse({
        leaseId: "job-1",
        slotName: "slot-1",
        path: "/pool/slot-1",
        repoRoot: "/repo",
        state: "leased",
        target: {
          mode: "detached",
          requestedRef: "main",
          resolvedRefSha: "abc123",
        },
        createdAt: NOW,
        updatedAt: NOW,
      });
      expect(result.success).toBe(false);
    });

    it("throws INVALID_GROVE_STATE on invalid lease-first shape", () => {
      expect(() =>
        parseLeaseFirstState({
          slots: [{ slotName: "slot-1", path: "/pool/slot-1", state: "leased" }],
          leases: [],
        }),
      ).toThrowError(InvalidGroveStateError);
    });

    it("throws INVALID_GROVE_STATE when joint invariants fail", () => {
      expect(() =>
        parseLeaseFirstState({
          slots: [
            {
              slotName: "slot-1",
              path: "/pool/slot-1",
              state: "available",
              createdAt: NOW,
              updatedAt: NOW,
            },
          ],
          leases: [
            {
              leaseId: "job-1",
              slotName: "slot-1",
              path: "/pool/slot-1",
              repoRoot: "/repo",
              state: "leased",
              target: {
                mode: "detached",
                requestedRef: "main",
                resolvedRefSha: "abc123",
              },
              acquiredHeadSha: "abc123",
              currentHeadSha: "abc123",
              createdAt: NOW,
              updatedAt: NOW,
            },
          ],
        }),
      ).toThrowError(InvalidGroveStateError);
    });
  });

  describe("readLeaseFirstState / writeLeaseFirstState", () => {
    it("returns empty state when file is missing", async () => {
      const state = await readLeaseFirstState(groveDir);
      expect(state).toEqual({ slots: [], leases: [] });
    });

    it("round-trips lease-first state", async () => {
      await mkdir(groveDir, { recursive: true });
      const state: LeaseFirstGroveState = {
        slots: [
          {
            slotName: "slot-1",
            path: join(tmpDir, "slot-1"),
            state: "leased",
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        leases: [
          {
            leaseId: "job-1",
            slotName: "slot-1",
            path: join(tmpDir, "slot-1"),
            repoRoot: tmpDir,
            state: "leased",
            target: {
              mode: "detached",
              requestedRef: "main",
              resolvedRefSha: "abc123",
            },
            acquiredHeadSha: "abc123",
            currentHeadSha: "abc123",
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
      };

      await writeLeaseFirstState(groveDir, state);
      const read = await readLeaseFirstState(groveDir);
      expect(read.leases[0]?.leaseId).toBe("job-1");
    });

    it("reads legacy worktrees JSON via migration", async () => {
      await mkdir(groveDir, { recursive: true });
      await writeFile(
        join(groveDir, "grove-state.json"),
        JSON.stringify({
          worktrees: [
            {
              name: "slot-1",
              path: join(tmpDir, "slot-1"),
              created_at: NOW,
              leaseId: "job-1",
              branch: "agent/job-1",
              baseRef: "origin/main",
              baseSha: "abc123",
              acquiredHeadSha: "abc123",
              currentHeadSha: "abc123",
              state: "leased",
            },
          ],
        }),
      );

      const state = await readLeaseFirstState(groveDir, { repoRoot: tmpDir });
      expect(state.leases).toHaveLength(1);
      expect(state.slots[0]?.state).toBe("leased");
    });

    it("throws INVALID_GROVE_STATE on corrupt JSON", async () => {
      await mkdir(groveDir, { recursive: true });
      await writeFile(join(groveDir, "grove-state.json"), "{ bad json");
      await expect(readLeaseFirstState(groveDir)).rejects.toThrowError(InvalidGroveStateError);
    });
  });

  describe("healPoolState", () => {
    it("reclaims destroying slot with no matching destroying lease and dead owner", async () => {
      const slotPath = join(tmpDir, "slot-1");
      await mkdir(slotPath, { recursive: true });
      const state: LeaseFirstGroveState = {
        slots: [
          {
            slotName: "1",
            path: slotPath,
            state: "destroying",
            ownerPid: -1,
            ownerStartedAt: 1,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        leases: [],
      };

      const healed = await healPoolState(state);
      expect(healed.slots).toHaveLength(1);
      expect(healed.slots[0]?.state).toBe("available");
      expect(healed.slots[0]?.ownerPid).toBeUndefined();
    });

    it("keeps destroying slot when matching lease is destroying", async () => {
      const slotPath = join(tmpDir, "slot-1");
      await mkdir(slotPath, { recursive: true });
      const state: LeaseFirstGroveState = {
        slots: [
          {
            slotName: "1",
            path: slotPath,
            state: "destroying",
            ownerPid: -1,
            ownerStartedAt: 1,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        leases: [
          {
            leaseId: "job-1",
            slotName: "1",
            path: slotPath,
            repoRoot: tmpDir,
            state: "destroying",
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
      };

      const healed = await healPoolState(state);
      expect(healed.slots[0]?.state).toBe("destroying");
    });
  });

  describe("findOrAllocateSlot", () => {
    it("does not reclaim destroying slot that is still in use", async () => {
      const { repoDir, tmpDir, groveDir } = await setupRepo();
      const grove = await createTestGrove({
        repoRoot: repoDir,
        groveRoot: groveDir,
        maxTrees: 2,
      });
      const lease = await grove.acquire({
        leaseId: "busy-destroy-slot",
        mode: "detached",
        ref: "main",
      });

      const state = await loadPoolState(grove.poolDir, repoDir, { heal: false });
      state.leases = [];
      state.slots[0] = {
        ...state.slots[0]!,
        state: "destroying",
        ownerPid: undefined,
        ownerStartedAt: undefined,
      };

      const scriptPath = join(tmpDir, "sleep.mjs");
      await writeFile(scriptPath, "setInterval(() => {}, 1000);");
      const child = execa("node", [scriptPath], { cwd: lease.path });
      await new Promise((resolve) => setTimeout(resolve, 500));

      try {
        const result = await findOrAllocateSlot(state, grove.poolDir, {
          repoRoot: repoDir,
          maxTrees: 2,
        });

        expect(result.isNew).toBe(true);
        expect(state.slots[0]?.state).toBe("destroying");
      } finally {
        child.kill();
        await child.catch(() => {});
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("reclaims idle destroying slot for reuse", async () => {
      const { repoDir, tmpDir, groveDir } = await setupRepo();
      const grove = await createTestGrove({ repoRoot: repoDir, groveRoot: groveDir });
      await grove.acquire({
        leaseId: "idle-destroy-slot",
        mode: "detached",
        ref: "main",
      });

      const state = await loadPoolState(grove.poolDir, repoDir, { heal: false });
      state.leases = [];
      state.slots[0] = {
        ...state.slots[0]!,
        state: "destroying",
        ownerPid: -1,
        ownerStartedAt: 1,
      };

      const result = await findOrAllocateSlot(state, grove.poolDir, {
        repoRoot: repoDir,
        maxTrees: 16,
      });

      expect(result.isNew).toBe(false);
      expect(result.slot.slotName).toBe("1");
      expect(result.slot.state).toBe("available");
      await rm(tmpDir, { recursive: true, force: true });
    });
  });
});
