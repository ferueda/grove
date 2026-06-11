import { Command } from "commander";
import { loadGrove } from "../utils.js";
import { spawn } from "node:child_process";
import pc from "picocolors";

export const acquireCmd = new Command("acquire")
  .description("Acquire a worktree from the pool")
  .option("--shell", "Drop into an interactive subshell inside the worktree")
  .option("-r, --repo <path>", "Path to repository root")
  .action(async (options) => {
    try {
      const grove = await loadGrove({ repo: options.repo });
      const slot = await grove.acquire();

      if (options.shell) {
        console.error(pc.green(`🌳 Entered worktree at ${slot.path}. Type 'exit' to return.`));

        const shell = process.env.SHELL || "/bin/sh";
        const env = { ...process.env, GROVE_DIR: slot.path };

        const child = spawn(shell, [], {
          stdio: "inherit",
          env,
          cwd: slot.path,
        });

        child.on("exit", async (code) => {
          try {
            await grove.release(slot.path);
            console.error(pc.green("🌳 Worktree returned to pool."));
          } catch (err: any) {
            console.error(pc.red(`🌳 Warning: failed to release worktree: ${err.message}`));
          }
          process.exit(code ?? 0);
        });
      } else {
        // Output raw path to stdout for pipeability
        process.stdout.write(slot.path + "\n");
      }
    } catch (err: any) {
      console.error(pc.red(err.message));
      process.exit(1);
    }
  });
