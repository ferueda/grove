import { Command } from "commander";
import { loadGrove } from "../utils.js";
import { handleError } from "../error-handler.js";
import { spawn } from "node:child_process";
import pc from "picocolors";
import type { AcquireLeaseOptions } from "@ferueda/grove";

export const acquireCmd = new Command("acquire")
  .description("Acquire a worktree from the pool")
  .option("--shell", "Drop into an interactive subshell inside the worktree")
  .option("-r, --repo <path>", "Path to repository root")
  .option("--lease <id>", "Lease ID to acquire")
  .option("--owner <id>", "Owner ID for the lease")
  .option("--branch <name>", "Branch to check out")
  .option("--ref <sha>", "Ref to check out detached")
  .option("--create-branch-from <ref>", "Create branch from this ref")
  .option("--fail-if-exists", "Fail if branch already exists")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    try {
      const grove = await loadGrove({ repo: options.repo });

      if (options.lease) {
        let modeOpts: any = {};
        if (options.branch) {
          modeOpts = { mode: "branch", branch: options.branch };
          if (options.createBranchFrom) {
            modeOpts.createBranch = {
              from: options.createBranchFrom,
              ifExists: options.failIfExists ? "fail" : "reuse",
            };
          }
        } else if (options.ref) {
          modeOpts = { mode: "detached", ref: options.ref };
        } else {
          // fallback to default branch logic if nothing specified?
          modeOpts = { mode: "branch", branch: "main" }; // or we can just let SDK handle it, wait SDK requires mode.
          // Since SDK requires mode, if not specified let's default to branch "main" or what SDK would do
          // actually let's throw
          throw new Error("Lease mode requires either --branch or --ref");
        }

        const acquireOpts: AcquireLeaseOptions = {
          leaseId: options.lease,
          ownerId: options.owner,
          ...modeOpts,
        };

        const lease = await grove.acquire(acquireOpts);

        if (options.json) {
          process.stdout.write(JSON.stringify(lease, null, 2) + "\n");
          return;
        }

        console.error(pc.green(`🌳 Acquired lease ${lease.leaseId} at ${lease.path}`));
        return;
      }

      // Legacy flow
      const slot = await grove.acquire();

      if (options.shell) {
        console.error(pc.green(`🌳 Entered worktree at ${slot.path}. Type 'exit' to return.`));

        const shell = process.env.SHELL || "/bin/sh";
        const env = { ...process.env, GROVE_DIR: slot.path };

        const sigHandler = () => {};
        process.on("SIGINT", sigHandler);
        process.on("SIGTERM", sigHandler);

        const child = spawn(shell, [], {
          stdio: "inherit",
          env,
          cwd: slot.path,
        });

        child.on("exit", async (code) => {
          process.off("SIGINT", sigHandler);
          process.off("SIGTERM", sigHandler);
          try {
            await grove.release(slot.path);
            console.error(pc.green("🌳 Worktree returned to pool."));
          } catch (releaseErr: unknown) {
            const msg = releaseErr instanceof Error ? releaseErr.message : String(releaseErr);
            console.error(pc.red(`🌳 Warning: failed to release worktree: ${msg}`));
          }
          process.exit(code ?? 0);
        });
      } else {
        if (options.json) {
          process.stdout.write(JSON.stringify(slot, null, 2) + "\n");
        } else {
          process.stdout.write(slot.path + "\n");
        }
      }
    } catch (err: unknown) {
      handleError(err);
    }
  });
