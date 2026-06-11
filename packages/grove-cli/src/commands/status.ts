import { Command } from "commander";
import { loadGrove } from "../utils.js";
import pc from "picocolors";

export const statusCmd = new Command("status")
  .description("Show the status of all worktrees in the pool")
  .option("-r, --repo <path>", "Path to repository root")
  .action(async (options) => {
    try {
      const grove = await loadGrove({ repo: options.repo });
      const trees = await grove.list();

      if (trees.length === 0) {
        console.log("🌳 No worktrees in pool.");
        return;
      }

      console.log(pc.bold("ID\tStatus\t\tPath"));
      console.log("----------------------------------------");

      for (const wt of trees) {
        let statusStr = "";
        switch (wt.status) {
          case "available":
            statusStr = pc.green(wt.status);
            break;
          case "in-use":
            statusStr = pc.red(wt.status);
            break;
          case "dirty":
            statusStr = pc.yellow(wt.status);
            break;
          case "you're here":
            statusStr = pc.cyan(wt.status);
            break;
        }

        const coloredPadded = statusStr + " ".repeat(12 - wt.status.length);

        console.log(`${wt.name}\t${coloredPadded}\t${wt.path}`);

        if (wt.processes.length > 0) {
          console.log(pc.gray(`  └─ Processes:`));
          for (const p of wt.processes) {
            console.log(pc.gray(`     - PID: ${p.PID} ${p.Name ? `(${p.Name})` : ""}`));
          }
        }
      }
    } catch (err: any) {
      console.error(pc.red(err.message));
      process.exit(1);
    }
  });
