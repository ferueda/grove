import { Command } from "commander";
import { loadGroveContext } from "../utils.js";
import { handleError } from "../error-handler.js";
import { statusEnvelope, writeJson } from "../json-output.js";
import { suggestionsForList } from "../suggestions.js";
import pc from "picocolors";

export const statusCmd = new Command("status")
  .description("Show pool dashboard with capacity and lease summary")
  .option("-r, --repo <path>", "Path to repository root")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const { grove, repoRoot, groveDir } = await loadGroveContext({ repo: options.repo });
      const [leases, stats] = await Promise.all([grove.list(), grove.stats()]);

      if (options.json) {
        writeJson(
          statusEnvelope(repoRoot, groveDir, stats, leases, {
            suggestions: suggestionsForList(stats),
          }),
        );
        return;
      }

      console.error(pc.bold("Grove pool status"));
      console.error(`Repo:  ${repoRoot}`);
      console.error(`Pool:  ${groveDir}`);
      console.error(
        `Slots: ${stats.pool.used}/${stats.pool.max} used (${stats.pool.available} available)`,
      );
      console.error(`Leases: ${stats.count}`);
      if (Object.keys(stats.byState).length > 0) {
        const stateSummary = Object.entries(stats.byState)
          .map(([state, count]) => `${state}=${count}`)
          .join(", ");
        console.error(`By state: ${stateSummary}`);
      }
    } catch (err: unknown) {
      handleError(err);
    }
  });
