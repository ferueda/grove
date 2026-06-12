import { isReleaseResult, isRepairResult } from "@ferueda/grove";
import { Command } from "commander";
import { loadGrove } from "../utils.js";
import { handleError } from "../error-handler.js";
import pc from "picocolors";

export const repairCmd = new Command("repair")
  .description("Repair a stuck or broken lease")
  .argument("<leaseId>", "Lease ID to repair")
  .requiredOption(
    "--action <action>",
    "Action to take: quarantine, resume-acquire, resume-cleanup, or force-destroy",
  )
  .option("-f, --force", "Force action even if processes are running")
  .option("-r, --repo <path>", "Path to repository root")
  .option("--json", "Output result as JSON")
  .action(async (leaseId, options) => {
    try {
      if (
        !["quarantine", "resume-acquire", "resume-cleanup", "force-destroy"].includes(
          options.action,
        )
      ) {
        throw new Error(
          "Invalid action. Must be quarantine, resume-acquire, resume-cleanup, or force-destroy.",
        );
      }

      const grove = await loadGrove({ repo: options.repo });
      const result = await grove.repair({
        leaseId,
        action: options.action as any,
        force: options.force,
      });
      if (options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else if (isRepairResult(result)) {
        if (result.status === "destroyed") {
          console.error(pc.green(`🌳 Lease ${result.leaseId} was successfully force-destroyed.`));
        } else {
          console.error(
            pc.green(
              `🌳 Lease ${result.leaseId} repaired with action ${options.action}. New state: ${result.lease.state}`,
            ),
          );
        }
      } else if (isReleaseResult(result)) {
        const state = result.status === "released" ? "released" : result.lease.state;
        console.error(
          pc.green(`🌳 Lease ${result.leaseId} repaired with action ${options.action}. Result: ${result.status} (${state}).`),
        );
      } else {
        console.error(
          pc.green(`🌳 Lease ${result.leaseId} repaired with action ${options.action}. New state: ${result.state}`),
        );
      }
    } catch (err: unknown) {
      handleError(err);
    }
  });
