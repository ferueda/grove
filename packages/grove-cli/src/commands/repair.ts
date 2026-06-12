import {
  InvalidInputError,
  isReleaseResult,
  isRepairResult,
} from "@ferueda/grove";
import { Command } from "commander";
import { loadGrove } from "../utils.js";
import { handleError } from "../error-handler.js";
import { leaseEnvelope, resultEnvelope, writeJson } from "../json-output.js";
import pc from "picocolors";

const REPAIR_ACTIONS = ["quarantine", "resume-acquire", "resume-cleanup", "force-destroy"] as const;

export const repairCmd = new Command("repair")
  .description("Repair a stuck or broken lease")
  .requiredOption("--lease-id <id>", "Lease ID to repair")
  .requiredOption("--action <action>", "Action: quarantine, resume-acquire, resume-cleanup, force-destroy")
  .option("-f, --force", "Force action even if processes are running")
  .option("-r, --repo <path>", "Path to repository root")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      if (!REPAIR_ACTIONS.includes(options.action)) {
        throw new InvalidInputError(
          "Invalid action. Must be quarantine, resume-acquire, resume-cleanup, or force-destroy.",
        );
      }

      const grove = await loadGrove({ repo: options.repo });
      const result = await grove.repair({
        leaseId: options.leaseId,
        action: options.action,
        force: options.force,
      });

      if (options.json) {
        if (isRepairResult(result)) {
          writeJson(resultEnvelope(result));
        } else if (isReleaseResult(result)) {
          writeJson(resultEnvelope(result));
        } else {
          writeJson(leaseEnvelope(result));
        }
        return;
      }

      if (isRepairResult(result)) {
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
          pc.green(
            `🌳 Lease ${result.leaseId} repaired with action ${options.action}. Result: ${result.status} (${state}).`,
          ),
        );
      } else {
        console.error(
          pc.green(
            `🌳 Lease ${result.leaseId} repaired with action ${options.action}. New state: ${result.state}`,
          ),
        );
      }
    } catch (err: unknown) {
      handleError(err);
    }
  });
