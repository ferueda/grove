import { Command } from "commander";
import { loadGrove } from "../utils.js";
import { handleError } from "../error-handler.js";
import { leaseEnvelope, writeJson } from "../json-output.js";
import { InvalidInputError } from "@ferueda/grove";
import pc from "picocolors";
import type { AcquireLeaseOptions } from "@ferueda/grove";

export const acquireCmd = new Command("acquire")
  .description("Acquire a lease-backed worktree from the pool")
  .requiredOption("--lease-id <id>", "Lease ID to acquire")
  .option("--owner-id <id>", "Owner ID for the lease")
  .option("--branch <name>", "Branch to check out")
  .option("--ref <ref>", "Ref to check out detached")
  .option("--create-from <ref>", "Create branch from this ref")
  .option("--reuse-existing-branch", "Reuse branch if it already exists")
  .option("--fail-if-exists", "Fail if branch already exists")
  .option("-r, --repo <path>", "Path to repository root")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      if (!options.branch && !options.ref) {
        throw new InvalidInputError("Acquire requires either --branch or --ref");
      }
      if (options.branch && options.ref) {
        throw new InvalidInputError("Acquire accepts only one of --branch or --ref");
      }
      if (options.reuseExistingBranch && options.failIfExists) {
        throw new InvalidInputError("Use only one of --reuse-existing-branch or --fail-if-exists");
      }

      const grove = await loadGrove({ repo: options.repo });

      const acquireOpts: AcquireLeaseOptions = options.branch
        ? {
            leaseId: options.leaseId,
            ownerId: options.ownerId,
            mode: "branch",
            branch: options.branch,
            ...(options.createFrom
              ? {
                  createBranch: {
                    from: options.createFrom,
                    ifExists: options.reuseExistingBranch ? ("reuse" as const) : ("fail" as const),
                  },
                }
              : {}),
          }
        : {
            leaseId: options.leaseId,
            ownerId: options.ownerId,
            mode: "detached",
            ref: options.ref,
          };

      const lease = await grove.acquire(acquireOpts);

      if (options.json) {
        writeJson(leaseEnvelope(lease));
        return;
      }

      console.error(pc.green(`🌳 Acquired lease ${lease.leaseId} at ${lease.path}`));
    } catch (err: unknown) {
      handleError(err);
    }
  });
