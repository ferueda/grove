import { Command } from "commander";
import { loadGrove } from "../utils.js";
import { handleError } from "../error-handler.js";
import { leaseEnvelope, writeJson } from "../json-output.js";
import { LeaseNotFoundError } from "@ferueda/grove";
import pc from "picocolors";

export const inspectCmd = new Command("inspect")
  .description("Inspect a specific lease")
  .requiredOption("--lease-id <id>", "Lease ID to inspect")
  .option("-r, --repo <path>", "Path to repository root")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const grove = await loadGrove({ repo: options.repo });
      const lease = await grove.inspect(options.leaseId);

      if (!lease) {
        throw new LeaseNotFoundError(`Lease ${options.leaseId} not found`);
      }

      if (options.json) {
        writeJson(leaseEnvelope(lease));
        return;
      }

      console.error(pc.bold(`Lease: ${lease.leaseId}`));
      console.error(`Path: ${lease.path}`);
      console.error(`State: ${lease.state}`);
      console.error(`Branch: ${lease.branch || "-"}`);
      console.error(`Safety: ${lease.processSafety}`);
      if (lease.pendingCleanup) {
        console.error(`Pending Cleanup: ${JSON.stringify(lease.pendingCleanup)}`);
      }
    } catch (err: unknown) {
      handleError(err);
    }
  });
