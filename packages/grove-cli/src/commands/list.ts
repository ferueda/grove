import { Command } from "commander";
import { loadGrove } from "../utils.js";
import { handleError } from "../error-handler.js";
import { leasesEnvelope, writeJson } from "../json-output.js";
import pc from "picocolors";

export const listCmd = new Command("list")
  .description("List leases in the pool")
  .option("-r, --repo <path>", "Path to repository root")
  .option("--include-processes", "Include process safety diagnostics")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const grove = await loadGrove({ repo: options.repo });
      const leases = await grove.list({
        includeProcesses: options.includeProcesses,
      });

      if (options.json) {
        writeJson(leasesEnvelope(leases));
        return;
      }

      if (leases.length === 0) {
        console.error("🌳 No leases in pool.");
        return;
      }

      console.error(pc.bold("Lease ID\tState\t\tBranch\t\tPath"));
      console.error("------------------------------------------------------------------");
      for (const lease of leases) {
        const stateStr =
          lease.state === "leased"
            ? pc.green(lease.state)
            : lease.state === "quarantined"
              ? pc.red(lease.state)
              : pc.yellow(lease.state);
        console.error(`${lease.leaseId}\t${stateStr}\t\t${lease.branch || "-"}\t\t${lease.path}`);
      }
    } catch (err: unknown) {
      handleError(err);
    }
  });
