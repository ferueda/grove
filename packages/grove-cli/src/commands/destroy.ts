import { Command } from "commander";
import { loadGrove } from "../utils.js";
import { handleError } from "../error-handler.js";
import pc from "picocolors";

export const destroyCmd = new Command("destroy")
  .description("Destroy a specific worktree from the pool")
  .argument("<pathOrLeaseId>", "Path or lease ID to destroy")
  .option("-f, --force", "Force destroy even if in use")
  .option("--delete-branch", "Also delete the branch associated with this lease")
  .option("-r, --repo <path>", "Path to repository root")
  .option("--json", "Output result as JSON")
  .action(async (pathOrLeaseId, options) => {
    try {
      const grove = await loadGrove({ repo: options.repo });
      await grove.destroy(pathOrLeaseId, { force: options.force, deleteBranch: options.deleteBranch });
      
      if (options.json) {
        process.stdout.write(JSON.stringify({ success: true, target: pathOrLeaseId }) + "\n");
      } else {
        console.error(pc.green(`🌳 Destroyed worktree/lease ${pathOrLeaseId}`));
      }
    } catch (err: unknown) {
      handleError(err);
    }
  });

export const destroyAllCmd = new Command("destroy-all")
  .description("Destroy all worktrees in the pool")
  .option("-f, --force", "Force destroy even if in use")
  .option("-r, --repo <path>", "Path to repository root")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const grove = await loadGrove({ repo: options.repo });
      await grove.destroyAll({ force: options.force });
      
      if (options.json) {
        process.stdout.write(JSON.stringify({ success: true }) + "\n");
      } else {
        console.error(pc.green("🌳 Destroyed all worktrees in the pool."));
      }
    } catch (err: unknown) {
      handleError(err);
    }
  });
