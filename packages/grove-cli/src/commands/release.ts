import { Command } from "commander";
import { loadGrove } from "../utils.js";
import { handleError } from "../error-handler.js";
import pc from "picocolors";

export const releaseCmd = new Command("release")
  .description("Release a worktree back to the pool")
  .argument("[path]", "Path to the worktree to release (defaults to CWD)")
  .option("-r, --repo <path>", "Path to repository root")
  .action(async (worktreePath, options) => {
    try {
      const targetPath = worktreePath || process.cwd();
      const grove = await loadGrove({ repo: options.repo });

      await grove.release(targetPath);
      console.error(pc.green("🌳 Worktree returned to pool."));
    } catch (err: unknown) {
      handleError(err);
    }
  });
