import { lock } from "proper-lockfile";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";

const command = process.argv[2];
if (!command) {
  process.exit(0);
}

if (command === "lock-probe") {
  const groveDir = process.argv[3];
  await mkdir(groveDir, { recursive: true });
  const lockTarget = join(groveDir, "grove-state.lock");
  await writeFile(lockTarget, "", { flag: "a" });

  try {
    await lock(lockTarget);
    console.log("lock-probe running");
    setInterval(() => {}, 1000);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
} else if (command === "check-lock") {
  const { check } = await import("proper-lockfile");
  const lockTarget = join(process.env.GROVE_POOL_DIR, "grove-state.lock");
  const isLocked = await check(lockTarget);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    join(process.env.GROVE_OUT_DIR, "lock-status.txt"),
    isLocked ? "LOCKED" : "UNLOCKED",
  );
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
