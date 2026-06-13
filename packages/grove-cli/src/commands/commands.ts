import { Command } from "commander";
import { commandsEnvelope, writeJson } from "../json-output.js";
import pc from "picocolors";

const COMMAND_CATALOG = [
  {
    name: "acquire",
    description: "Acquire a lease-backed worktree from the pool",
    usage: "grove acquire --json --lease-id <id> (--branch <name> | --ref <ref>)",
    output: "lease",
  },
  {
    name: "inspect",
    description: "Inspect a specific lease",
    usage: "grove inspect --json --lease-id <id>",
    output: "lease",
  },
  {
    name: "list",
    description: "List leases in the pool",
    usage: "grove list --json",
    output: "leases",
  },
  {
    name: "release",
    description: "Release a lease back to the pool",
    usage: "grove release --json --lease-id <id> --cleanup preserve|reset|quarantine",
    output: "result",
  },
  {
    name: "repair",
    description: "Repair a stuck or broken lease",
    usage:
      "grove repair --json --lease-id <id> --action quarantine|resume-acquire|resume-cleanup|force-destroy",
    output: "lease|result",
  },
  {
    name: "destroy",
    description: "Destroy a lease and remove its worktree",
    usage: "grove destroy --json --lease-id <id>",
    output: "result",
  },
  {
    name: "status",
    description: "Show pool dashboard with capacity and lease summary",
    usage: "grove status --json",
    output: "status",
  },
  {
    name: "commands",
    description: "List available Grove CLI commands",
    usage: "grove commands --json",
    output: "commands",
  },
] as const;

export const commandsCmd = new Command("commands")
  .description("List available Grove CLI commands")
  .option("--json", "Output result as JSON")
  .action((options) => {
    if (options.json) {
      writeJson(commandsEnvelope(COMMAND_CATALOG));
      return;
    }

    console.error(pc.bold("Grove commands:"));
    for (const cmd of COMMAND_CATALOG) {
      console.error(`  ${pc.cyan(cmd.name)} — ${cmd.description}`);
    }
  });
