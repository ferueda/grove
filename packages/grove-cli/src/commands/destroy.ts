import { Command } from "commander";
import { loadGrove } from "../utils.js";
import { handleError } from "../error-handler.js";
import { resultEnvelope, writeJson } from "../json-output.js";
import { suggestionsForDestroyedLease } from "../suggestions.js";
import pc from "picocolors";

export const destroyCmd = new Command("destroy")
  .description("Destroy a lease and remove its worktree")
  .requiredOption("--lease-id <id>", "Lease ID to destroy")
  .option("-f, --force", "Force destroy even if in use")
  .option("-r, --repo <path>", "Path to repository root")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const grove = await loadGrove({ repo: options.repo });
      await grove.destroy(options.leaseId, { force: options.force });

      if (options.json) {
        writeJson(
          resultEnvelope(
            { status: "destroyed", leaseId: options.leaseId },
            { suggestions: suggestionsForDestroyedLease(options.leaseId) },
          ),
        );
        return;
      }

      console.error(pc.green(`🌳 Destroyed lease ${options.leaseId}`));
    } catch (err: unknown) {
      handleError(err);
    }
  });
