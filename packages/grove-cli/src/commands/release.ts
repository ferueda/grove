import { Command } from "commander";
import { loadGrove } from "../utils.js";
import { handleError } from "../error-handler.js";
import pc from "picocolors";
import type { ReleaseLeaseOptions } from "@ferueda/grove";

export const releaseCmd = new Command("release")
  .description("Release a worktree back to the pool")
  .argument("[pathOrLeaseId]", "Path or lease ID to release (defaults to CWD)")
  .option("-r, --repo <path>", "Path to repository root")
  .option("--cleanup <action>", "Cleanup action (preserve, reset, quarantine)")
  .option("--reset-to <ref>", "Branch/ref to reset to")
  .option("-f, --force", "Force cleanup even if in use")
  .option("--json", "Output result as JSON")
  .action(async (pathOrLeaseId, options) => {
    try {
      const targetPath = pathOrLeaseId || process.cwd();
      const grove = await loadGrove({ repo: options.repo });

      if (options.cleanup) {
        if (!["preserve", "reset", "quarantine"].includes(options.cleanup)) {
          throw new Error("Invalid cleanup action");
        }

        let releaseOpts: ReleaseLeaseOptions;
        if (options.cleanup === "preserve") {
          releaseOpts = { cleanup: "preserve" };
        } else if (options.cleanup === "quarantine") {
          releaseOpts = { cleanup: "quarantine" };
        } else {
          releaseOpts = {
            cleanup: "reset",
            force: options.force
          };
          if (options.resetTo) {
            releaseOpts.resetTo = options.resetTo;
          }
        }

        const result = await grove.release(targetPath, releaseOpts);

        if (options.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
          return;
        }

        console.error(
          pc.green(`🌳 Lease ${result.leaseId} released with action ${options.cleanup} (${result.status}).`),
        );
        return;
      }

      await grove.release(targetPath);
      if (options.json) {
        process.stdout.write(JSON.stringify({ success: true, path: targetPath }) + "\n");
      } else {
        console.error(pc.green("🌳 Worktree returned to pool."));
      }
    } catch (err: unknown) {
      handleError(err);
    }
  });
