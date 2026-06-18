import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as detect from "../src/process/detect.js";
import { listLeaseRecords } from "../src/lease-view.js";
import { setupPathFixture } from "./helpers/git-repo.js";
import type { LeaseFirstGroveState } from "../src/schemas.js";

const NOW = "2026-01-01T00:00:00.000Z";

describe("listLeaseRecords", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses process scan when includeProcesses is enabled", async () => {
    const { tmpDir } = await setupPathFixture();
    const slotPath = join(tmpDir, "slot-1");
    await mkdir(slotPath, { recursive: true });

    const scan = {
      processes: [{ PID: 42, Name: "node" }],
      unverified: false,
    };
    const spy = vi.spyOn(detect, "findInWorktree").mockResolvedValue(scan);

    const state: LeaseFirstGroveState = {
      slots: [
        {
          slotName: "slot-1",
          path: slotPath,
          state: "leased",
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      leases: [
        {
          leaseId: "job-1",
          slotName: "slot-1",
          path: slotPath,
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

    const leases = await listLeaseRecords(state, { includeProcesses: true });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(leases[0]?.diagnostics?.lastProcessSafetyCheck?.processes).toEqual(scan.processes);
    expect(leases[0]?.processSafety).toBe("verified");
  });
});
