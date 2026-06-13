import type { Command } from "commander";

export function applyCliErrorRouting(command: Command): void {
  command.configureOutput({
    outputError: () => {
      // Grove handleError owns CLI error output.
    },
  });
  command.exitOverride();
  for (const subcommand of command.commands) {
    applyCliErrorRouting(subcommand);
  }
}
