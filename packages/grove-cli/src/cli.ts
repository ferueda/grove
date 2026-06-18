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
import { commandsCmd } from "./commands/commands.js";
import { statusCmd } from "./commands/status.js";
import { applyCliErrorRouting } from "./cli-error-routing.js";
import { isBenignCommanderExit } from "./commander-error.js";
import { cliVersion } from "./version.js";

process.on("uncaughtException", (err) => {
  console.error(pc.red(`Fatal: ${err.message}`));
  process.exitCode = 1;
});

process.on("unhandledRejection", (reason) => {
  console.error(pc.red(`Unhandled rejection: ${reason}`));
  process.exitCode = 1;
});

if (process.argv.includes("--json")) {
  setJson(true);
}

const program = new Command();

program
  .name("grove")
  .description("CLI for Grove - lease-first git worktree pool manager")
  .version(cliVersion)
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
program.addCommand(statusCmd);
program.addCommand(commandsCmd);

applyCliErrorRouting(program);

try {
  await program.parseAsync(process.argv);
} catch (err: unknown) {
  if (isBenignCommanderExit(err)) {
    process.exitCode = err.exitCode;
  } else {
    handleError(err);
  }
}
