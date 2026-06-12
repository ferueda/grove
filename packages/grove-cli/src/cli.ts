#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { handleError, setDebug, setJson } from "./error-handler.js";
import { acquireCmd } from "./commands/acquire.js";
import { releaseCmd } from "./commands/release.js";
import { listCmd } from "./commands/list.js";
import { destroyCmd } from "./commands/destroy.js";
import { inspectCmd } from "./commands/inspect.js";
import { repairCmd } from "./commands/repair.js";

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
  .description("CLI for Grove - lease-first git worktree pool manager")
  .version("0.1.0")
  .option("--debug", "Show verbose error output including stack traces")
  .hook("preAction", (_thisCommand, actionCommand) => {
    const opts = actionCommand.optsWithGlobals();
    if (opts.debug) setDebug(true);
    if (opts.json) setJson(true);
  });

program.addCommand(acquireCmd);
program.addCommand(releaseCmd);
program.addCommand(listCmd);
program.addCommand(destroyCmd);
program.addCommand(inspectCmd);
program.addCommand(repairCmd);

try {
  await program.parseAsync(process.argv);
} catch (err: unknown) {
  handleError(err);
}
