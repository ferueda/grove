import { Command } from "commander";
import { loadGrove } from "../utils.js";
import { handleError } from "../error-handler.js";
import pc from "picocolors";

export const repairCmd = new Command("repair")
  .description("Repair a stuck or broken lease")
  .argument("<leaseId>", "Lease ID to repair")
  .requiredOption("--action <action>", "Action to take: quarantine, resume-cleanup, or force-destroy")
  .option("-f, --force", "Force action even if processes are running")
  .option("-r, --repo <path>", "Path to repository root")
  .option("--json", "Output result as JSON")
  .action(async (leaseId, options) => {
    try {
      if (!["quarantine", "resume-cleanup", "force-destroy"].includes(options.action)) {
        throw new Error("Invalid action. Must be quarantine, resume-cleanup, or force-destroy.");
      }

      const grove = await loadGrove({ repo: options.repo });
      const lease = await grove.repair({
        leaseId,
        action: options.action as any,
        force: options.force,
      });
      if (!lease) {
        if (options.json) {
          process.stdout.write(JSON.stringify({ status: "destroyed", leaseId }) + "\n");
        } else {
          console.error(pc.green(`🌳 Lease ${leaseId} was successfully force-destroyed.`));
        }
        return;
      }
      
      if (options.json) {
        process.stdout.write(JSON.stringify(lease, null, 2) + "\n");
      } else {
        console.error(pc.green(`🌳 Lease ${lease.leaseId} repaired with action ${options.action}. New state: ${lease.state}`));
      }
    } catch (err: unknown) {
      handleError(err);
    }
  });
