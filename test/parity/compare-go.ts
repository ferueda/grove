import { execa } from "execa";
import { createGrove } from "../../src/index.js";
import { setupRepo } from "../helpers/git-repo.js";
import { rm } from "node:fs/promises";

const TREEHOUSE_BIN = "/Users/frueda/dev/treehouse/treehouse";

async function main() {
  console.log("--- Grove TS vs Go Treehouse Parity Test ---");

  const { repoDir, tmpDir, groveDir } = await setupRepo();
  try {
    const grove = await createGrove({ repoRoot: repoDir, groveDir: groveDir });

    // TS acquire
    const tsWt1 = await grove.acquire();
    console.log("[TS] Acquired:", tsWt1.path);

    // Go acquire
    const { stdout: goWt1 } = await execa(TREEHOUSE_BIN, [
      "acquire",
      "--repo",
      repoDir,
      "--grove-dir",
      groveDir,
    ]);
    console.log("[Go] Acquired:", goWt1.trim());

    if (tsWt1.path === goWt1.trim()) {
      console.error("FAIL: Go acquire returned the same path as TS acquire, double-booking?");
      process.exit(1);
    }

    // Go list
    const { stdout: goList } = await execa(TREEHOUSE_BIN, [
      "list",
      "--repo",
      repoDir,
      "--grove-dir",
      groveDir,
    ]);
    console.log("[Go] List:\n", goList.trim());

    // TS list
    const tsList = await grove.list();
    console.log("[TS] List:\n", tsList);

    if (tsList.length !== 2) {
      console.error("FAIL: TS list should see 2 worktrees");
      process.exit(1);
    }

    // Release TS
    await grove.release(tsWt1.path);
    console.log("[TS] Released:", tsWt1.path);

    // Re-acquire Go (should reuse TS slot)
    const { stdout: goWt2 } = await execa(TREEHOUSE_BIN, [
      "acquire",
      "--repo",
      repoDir,
      "--grove-dir",
      groveDir,
    ]);
    console.log("[Go] Acquired again:", goWt2.trim());

    if (goWt2.trim() !== tsWt1.path) {
      console.error(
        `FAIL: Go should have reused the released TS slot. Got ${goWt2.trim()} instead of ${tsWt1.path}`,
      );
      process.exit(1);
    }

    console.log("SUCCESS: Parity test passed!");
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main();
