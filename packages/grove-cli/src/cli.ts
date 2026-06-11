import { Command } from "commander";
import { acquireCmd } from "./commands/acquire.js";
import { releaseCmd } from "./commands/release.js";
import { statusCmd } from "./commands/status.js";
import { destroyCmd, destroyAllCmd } from "./commands/destroy.js";

const program = new Command();

program
  .name("grove")
  .description("CLI for Grove - A programmatic git worktree pool manager")
  .version("0.1.0");

program.addCommand(acquireCmd);
program.addCommand(releaseCmd);
program.addCommand(statusCmd);
program.addCommand(destroyCmd);
program.addCommand(destroyAllCmd);

try {
  await program.parseAsync(process.argv);
} catch (err: any) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
