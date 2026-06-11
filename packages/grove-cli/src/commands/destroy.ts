import { Command } from "commander";
import { loadGrove } from "../utils.js";
import { handleError } from "../error-handler.js";
import pc from "picocolors";

export const destroyCmd = new Command("destroy")
  .description("Destroy a specific worktree from the pool")
  .argument("<path>", "Path to the worktree to destroy")
  .option("-f, --force", "Force destroy even if in use")
  .option("-r, --repo <path>", "Path to repository root")
  .action(async (worktreePath, options) => {
    try {
      const grove = await loadGrove({ repo: options.repo });
      await grove.destroy(worktreePath, { force: options.force });
      console.error(pc.green(`🌳 Destroyed worktree at ${worktreePath}`));
    } catch (err: unknown) {
      handleError(err);
    }
  });

export const destroyAllCmd = new Command("destroy-all")
  .description("Destroy all worktrees in the pool")
  .option("-f, --force", "Force destroy even if in use")
  .option("-r, --repo <path>", "Path to repository root")
  .action(async (options) => {
    try {
      const grove = await loadGrove({ repo: options.repo });
      await grove.destroyAll({ force: options.force });
      console.error(pc.green("🌳 Destroyed all worktrees in the pool."));
    } catch (err: unknown) {
      handleError(err);
    }
  });
