import { Command } from "commander";
import { loadGrove } from "../utils.js";
import { handleError } from "../error-handler.js";
import { resultEnvelope, writeJson } from "../json-output.js";
import { suggestionsForReleaseResult } from "../suggestions.js";
import { InvalidInputError } from "@ferueda/grove";
import pc from "picocolors";
import type { ReleaseLeaseOptions } from "@ferueda/grove";

export const releaseCmd = new Command("release")
  .description("Release a lease back to the pool")
  .requiredOption("--lease-id <id>", "Lease ID to release")
  .requiredOption("--cleanup <action>", "Cleanup action: preserve, reset, or quarantine")
  .option("--reset-to <ref>", "Branch/ref to reset to")
  .option("-f, --force", "Force cleanup even if in use")
  .option("-r, --repo <path>", "Path to repository root")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      if (!["preserve", "reset", "quarantine"].includes(options.cleanup)) {
        throw new InvalidInputError("Invalid cleanup action", {
          cleanup: options.cleanup,
          allowed: ["preserve", "reset", "quarantine"],
        });
      }

      const grove = await loadGrove({ repo: options.repo });

      let releaseOpts: ReleaseLeaseOptions;
      if (options.cleanup === "preserve") {
        releaseOpts = { cleanup: "preserve" };
      } else if (options.cleanup === "quarantine") {
        releaseOpts = { cleanup: "quarantine" };
      } else {
        releaseOpts = { cleanup: "reset", force: options.force };
        if (options.resetTo) {
          releaseOpts.resetTo = options.resetTo;
        }
      }

      const result = await grove.release(options.leaseId, releaseOpts);

      if (options.json) {
        writeJson(
          resultEnvelope(result, { suggestions: suggestionsForReleaseResult(result) }),
        );
        return;
      }

      console.error(
        pc.green(
          `🌳 Lease ${result.leaseId} released with action ${options.cleanup} (${result.status}).`,
        ),
      );
    } catch (err: unknown) {
      handleError(err);
    }
  });
