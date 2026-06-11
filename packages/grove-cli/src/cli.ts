#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { handleError, setDebug } from "./error-handler.js";
import { acquireCmd } from "./commands/acquire.js";
import { releaseCmd } from "./commands/release.js";
import { statusCmd } from "./commands/status.js";
import { destroyCmd, destroyAllCmd } from "./commands/destroy.js";

process.on("uncaughtException", (err) => {
  console.error(pc.red(`Fatal: ${err.message}`));
  process.exitCode = 1;
});

process.on("unhandledRejection", (reason) => {
  console.error(pc.red(`Unhandled rejection: ${reason}`));
  process.exitCode = 1;
});

const program = new Command();

program
  .name("grove")
  .description("CLI for Grove - A programmatic git worktree pool manager")
  .version("0.1.0")
  .option("--debug", "Show verbose error output including stack traces")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.optsWithGlobals();
    if (opts.debug) setDebug(true);
  });

program.addCommand(acquireCmd);
program.addCommand(releaseCmd);
program.addCommand(statusCmd);
program.addCommand(destroyCmd);
program.addCommand(destroyAllCmd);

try {
  await program.parseAsync(process.argv);
} catch (err: unknown) {
  if (process.exitCode !== 1) {
    handleError(err);
  }
}
