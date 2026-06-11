import { Command } from "commander";
import { loadGrove } from "../utils.js";
import { handleError } from "../error-handler.js";
import pc from "picocolors";

export const inspectCmd = new Command("inspect")
  .description("Inspect a specific lease or worktree")
  .argument("<pathOrLeaseId>", "Path or lease ID to inspect")
  .option("-r, --repo <path>", "Path to repository root")
  .option("--json", "Output result as JSON")
  .action(async (pathOrLeaseId, options) => {
    try {
      const grove = await loadGrove({ repo: options.repo });
      const lease = await grove.inspect(pathOrLeaseId);
      
      if (!lease) {
        throw new Error(`Lease not found: ${pathOrLeaseId}`);
      }

      if (options.json) {
        process.stdout.write(JSON.stringify(lease, null, 2) + "\n");
      } else {
        console.log(pc.bold(`Lease: ${lease.leaseId}`));
        console.log(`Path: ${lease.path}`);
        console.log(`State: ${lease.state}`);
        console.log(`Branch: ${lease.branch || "-"}`);
        console.log(`Safety: ${lease.processSafety}`);
        if (lease.pendingCleanup) {
          console.log(`Pending Cleanup: ${JSON.stringify(lease.pendingCleanup)}`);
        }
      }
    } catch (err: unknown) {
      handleError(err);
    }
  });
