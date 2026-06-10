import { lock } from "proper-lockfile";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";

const args = process.argv.slice(2);
if (args.length === 0) {
  process.exit(0);
}

const command = args[0];

if (command === "lock-probe") {
  const groveDir = args[1];
  await mkdir(groveDir, { recursive: true });
  const lockTarget = join(groveDir, "grove-state.lock");
  await writeFile(lockTarget, "", { flag: "a" });

  try {
    await lock(lockTarget);
    console.log("lock-probe running");
    // keep alive until killed
    setInterval(() => {}, 1000);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
} else if (command === "acquire-during-hook") {
  const repoRoot = args[1];
  const groveDir = args[2];
  const sentinel = args[3];
  const chdir = args[4];

  if (chdir) {
    process.chdir(chdir);
  }

  import("../../dist/index.js").then(({ createGrove }) => {
    createGrove({ repoRoot, groveDir })
      .then((grove) => grove.acquire())
      .then((slot) => {
        import("node:fs/promises").then(({ writeFile }) => {
          writeFile(sentinel, slot.path + "\n").then(() => {
            process.exit(0);
          });
        });
      })
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  });
} else if (command === "supersede-destroy") {
  const groveDir = args[1];
  const wtPath = args[2];
  const sentinel = args[3];

  import("node:fs/promises").then(({ readFile, writeFile }) => {
    const stateFile = join(groveDir, "grove-state.json");
    readFile(stateFile, "utf8")
      .then((data) => {
        const state = JSON.parse(data);
        for (const wt of state.worktrees) {
          if (wt.path === wtPath) {
            wt.destroying = false;
            delete wt.owner_pid;
            delete wt.owner_started_at;
          }
        }
        return writeFile(stateFile, JSON.stringify(state, null, 2));
      })
      .then(() => {
        return writeFile(sentinel, "superseded\n");
      })
      .then(() => {
        process.exit(0);
      })
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  });
} else if (command === "check-lock") {
  import("proper-lockfile").then(({ check }) => {
    const lockTarget = join(process.env.GROVE_POOL_DIR, "grove-state.lock");
    check(lockTarget)
      .then((isLocked) => {
        import("node:fs").then(({ writeFileSync }) => {
          writeFileSync(
            join(process.env.GROVE_OUT_DIR, "lock-status.txt"),
            isLocked ? "LOCKED" : "UNLOCKED",
          );
        });
      })
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  });
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
