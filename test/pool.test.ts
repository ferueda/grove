import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createGrove } from "../src/index.js";
import { setupRepo } from "./helpers/git-repo.js";
import { existsSync } from "node:fs";
import { rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { startedAt } from "../src/process/detect.js";

describe("Pool Core (Cluster A & B)", () => {
  let tmpDirs: string[] = [];

  beforeEach(() => {
    tmpDirs = [];
  });

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("acquire returns worktree path with detached HEAD", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const { path: wtPath } = await grove.acquire();

    expect(existsSync(wtPath)).toBe(true);

    const { stdout } = await execa("git", ["branch", "--show-current"], { cwd: wtPath });
    expect(stdout.trim()).toBe(""); // Detached HEAD means no current branch name
  });

  it("acquire -> modify -> release -> re-acquire is clean", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const { path: wt1 } = await grove.acquire();

    await writeFile(join(wt1, "dirty.txt"), "dirty contents");
    await grove.release(wt1);

    const { path: wt2 } = await grove.acquire();

    expect(wt2).toBe(wt1);
    expect(existsSync(join(wt2, "dirty.txt"))).toBe(false);
  });

  it("release works when parent cwd is elsewhere", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const { path: wt } = await grove.acquire();

    const originalCwd = process.cwd();
    process.chdir(tmpDir);

    try {
      await expect(grove.release(wt)).resolves.toBeUndefined();
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("runs postCreate hook in worktree", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({
      repoRoot: repoDir,
      groveRoot: groveDir,
      hooks: {
        postCreate: [
          process.platform === "win32"
            ? "echo hello > sentinel.txt"
            : 'echo "hello" > sentinel.txt',
        ],
      },
    });

    const { path: wt } = await grove.acquire();
    expect(existsSync(join(wt, "sentinel.txt"))).toBe(true);
    const content = await readFile(join(wt, "sentinel.txt"), "utf8");
    expect(content.trim()).toBe("hello");
  });

  it("hook failure does not fail acquire", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({
      repoRoot: repoDir,
      groveRoot: groveDir,
      hooks: {
        postCreate: ["exit 1"],
      },
    });

    const { path: wt } = await grove.acquire();
    expect(existsSync(wt)).toBe(true);
  });

  it("runs postCreate hook after releasing state lock", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({
      repoRoot: repoDir,
      groveRoot: groveDir,
      hooks: {
        postCreate: [`node \${GROVE_PROJECT_ROOT}/test/helpers/hook-probe.mjs check-lock`],
      },
    });

    process.env["GROVE_POOL_DIR"] = grove.poolDir;
    process.env["GROVE_OUT_DIR"] = tmpDir;
    process.env["GROVE_PROJECT_ROOT"] = process.cwd();

    await grove.acquire();

    const status = await readFile(join(tmpDir, "lock-status.txt"), "utf8");
    expect(status).toBe("UNLOCKED");

    delete process.env["GROVE_POOL_DIR"];
    delete process.env["GROVE_OUT_DIR"];
    delete process.env["GROVE_PROJECT_ROOT"];
  });

  it("does not reuse worktree reserved by postCreate hook", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({
      repoRoot: repoDir,
      groveRoot: groveDir,
      hooks: {
        postCreate: [process.platform === "win32" ? "timeout 1" : "sleep 0.5"],
      },
    });

    const p1 = grove.acquire();
    await new Promise((r) => setTimeout(r, 100));
    const p2 = grove.acquire();

    const [wt1, wt2] = await Promise.all([p1, p2]);
    expect(wt1.path).not.toBe(wt2.path);
  });
  it("lists all pools correctly", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const { path: wt1 } = await grove.acquire();
    const { path: wt2 } = await grove.acquire();

    await grove.release(wt2);

    const list = await grove.list();
    expect(list).toHaveLength(2);
    expect(list.map((l) => l.path).sort()).toEqual([wt1, wt2].sort());

    const l1 = list.find((l) => l.path === wt1);
    const l2 = list.find((l) => l.path === wt2);

    expect(l1?.status).toBe("in-use"); // wt1 was never released
    expect(l2?.status).toBe("available"); // wt2 was released
  });

  it("throws when maxTrees reached", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir, maxTrees: 2 });

    await grove.acquire();
    await grove.acquire();

    await expect(grove.acquire()).rejects.toThrow(/Exhausted worktrees/);
  });

  it("recovers destroying worktree when owner is gone", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const { path: wtPath } = await grove.acquire();
    await grove.release(wtPath);

    const stateFile = join(grove.poolDir, "grove-state.json");
    const data = await readFile(stateFile, "utf8");
    const state = JSON.parse(data);
    state.worktrees[0].destroying = true;
    state.worktrees[0].owner_pid = 999999;
    await writeFile(stateFile, JSON.stringify(state, null, 2));

    const list = await grove.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.path).toBe(wtPath);

    const dataHealed = await readFile(stateFile, "utf8");
    const stateHealed = JSON.parse(dataHealed);
    expect(stateHealed.worktrees[0].destroying).toBeUndefined();
    expect(stateHealed.worktrees[0].owner_pid).toBeUndefined();
  });

  it("recovers destroying worktree when owner identity does not match", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const { path: wtPath } = await grove.acquire();
    await grove.release(wtPath);

    const stateFile = join(grove.poolDir, "grove-state.json");
    const data = await readFile(stateFile, "utf8");
    const state = JSON.parse(data);
    state.worktrees[0].destroying = true;
    state.worktrees[0].owner_pid = process.pid;
    state.worktrees[0].owner_started_at = 1;
    await writeFile(stateFile, JSON.stringify(state, null, 2));

    const list = await grove.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.path).toBe(wtPath);

    const dataHealed = await readFile(stateFile, "utf8");
    const stateHealed = JSON.parse(dataHealed);
    expect(stateHealed.worktrees[0].destroying).toBeUndefined();
    expect(stateHealed.worktrees[0].owner_pid).toBeUndefined();
    expect(stateHealed.worktrees[0].owner_started_at).toBeUndefined();
  });

  it("release rejects destroying worktree", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const { path: wtPath } = await grove.acquire();
    await grove.release(wtPath);

    const stateFile = join(grove.poolDir, "grove-state.json");
    const data = await readFile(stateFile, "utf8");
    const state = JSON.parse(data);
    state.worktrees[0].destroying = true;
    state.worktrees[0].owner_pid = process.pid;
    const start = await startedAt(process.pid);
    if (start) state.worktrees[0].owner_started_at = start;
    await writeFile(stateFile, JSON.stringify(state, null, 2));

    await expect(grove.release(wtPath)).rejects.toThrow(/is being destroyed/);
  });

  it("skips dirty worktree during acquire", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const { path: wt1 } = await grove.acquire();
    await grove.release(wt1);

    await writeFile(join(wt1, "dirty.txt"), "dirty stuff");

    const { path: wt2 } = await grove.acquire();
    expect(wt2).not.toBe(wt1);
    expect(existsSync(wt2)).toBe(true);
  });

  it("skips in-use worktree during acquire", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const { path: wt1 } = await grove.acquire();
    await grove.release(wt1);

    const sub = execa("node", ["-e", "setInterval(() => {}, 1000)"], { cwd: wt1 });
    sub.catch(() => {});
    tmpDirs.push(wt1);

    try {
      await new Promise((r) => setTimeout(r, 200));

      const { path: wt2 } = await grove.acquire();
      expect(wt2).not.toBe(wt1);
    } finally {
      sub.kill();
    }
  });

  it("acquire recovers and heals destroying worktree when owner is gone", async () => {
    const { repoDir, tmpDir, groveDir } = await setupRepo();
    tmpDirs.push(tmpDir);

    const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
    const { path: wtPath } = await grove.acquire();
    await grove.release(wtPath);

    const stateFile = join(grove.poolDir, "grove-state.json");
    const data = await readFile(stateFile, "utf8");
    const state = JSON.parse(data);
    state.worktrees[0].destroying = true;
    state.worktrees[0].owner_pid = 999999;
    await writeFile(stateFile, JSON.stringify(state, null, 2));

    const { path: wtAcquired } = await grove.acquire();
    expect(wtAcquired).toBe(wtPath);

    const stateAfter = JSON.parse(await readFile(stateFile, "utf8"));
    expect(stateAfter.worktrees[0].destroying).toBeUndefined();
    expect(stateAfter.worktrees[0].owner_pid).toBe(process.pid);
  });

  describe("Destroy and DestroyAll", () => {
    it("runs preDestroy hook", async () => {
      const { repoDir, tmpDir, groveDir } = await setupRepo();
      tmpDirs.push(tmpDir);
      const grove = await createGrove({
        repoRoot: repoDir,
        groveRoot: groveDir,
        hooks: {
          preDestroy: [
            process.platform === "win32"
              ? "echo hook-run > %GROVE_OUT_DIR%/sentinel.txt"
              : 'echo "hook-run" > $GROVE_OUT_DIR/sentinel.txt',
          ],
        },
      });
      process.env["GROVE_OUT_DIR"] = tmpDir;
      const { path: wt } = await grove.acquire();
      await grove.destroy(wt, { force: true });

      const content = await readFile(join(tmpDir, "sentinel.txt"), "utf8");
      expect(content.trim()).toBe("hook-run");
      delete process.env["GROVE_OUT_DIR"];
    });

    it("non-force rejects reserved worktree", async () => {
      const { repoDir, tmpDir, groveDir } = await setupRepo();
      tmpDirs.push(tmpDir);
      const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
      const { path: wt } = await grove.acquire();

      await expect(grove.destroy(wt)).rejects.toThrow(/in use by an agent/);
      expect(existsSync(wt)).toBe(true);
    });

    it("force destroys reserved worktree", async () => {
      const { repoDir, tmpDir, groveDir } = await setupRepo();
      tmpDirs.push(tmpDir);
      const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
      const { path: wt } = await grove.acquire();

      await grove.destroy(wt, { force: true });
      expect(existsSync(wt)).toBe(false);
    });

    it("destroyAll non-force rejects reserved worktree", async () => {
      const { repoDir, tmpDir, groveDir } = await setupRepo();
      tmpDirs.push(tmpDir);
      const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
      const { path: wt } = await grove.acquire();

      await expect(grove.destroyAll()).rejects.toThrow(/in use by an agent/);
      expect(existsSync(wt)).toBe(true);
    });

    it("destroyAll force destroys reserved worktrees", async () => {
      const { repoDir, tmpDir, groveDir } = await setupRepo();
      tmpDirs.push(tmpDir);
      const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
      const { path: wt } = await grove.acquire();

      await grove.destroyAll({ force: true });
      expect(existsSync(wt)).toBe(false);

      const list = await grove.list();
      expect(list.length).toBe(0);
    });

    it("destroy does not allow hook acquire to reuse pending destroy worktree", async () => {
      const { repoDir, tmpDir, groveDir } = await setupRepo();
      tmpDirs.push(tmpDir);

      const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
      const { path: wtPath } = await grove.acquire();

      const sentinel = join(tmpDir, "acquired.txt");
      const scriptPath = join(process.cwd(), "test", "helpers", "hook-probe.mjs");
      const hookCmd = `node ${scriptPath} acquire-during-hook "${repoDir}" "${grove.poolDir}" "${sentinel}"`;

      const groveWithHook = await createGrove({
        repoRoot: repoDir,
        groveRoot: groveDir,
        hooks: {
          preDestroy: [hookCmd],
        },
      });

      await groveWithHook.destroy(wtPath, { force: true });

      const hookAcquired = (await readFile(sentinel, "utf8")).trim();
      expect(hookAcquired).not.toBe(wtPath);
      expect(existsSync(hookAcquired)).toBe(true);
    });

    it("destroy preserves superseded reservation after hook", async () => {
      const { repoDir, tmpDir, groveDir } = await setupRepo();
      tmpDirs.push(tmpDir);

      const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
      const { path: wtPath } = await grove.acquire();
      await grove.release(wtPath);

      const sentinel = join(tmpDir, "superseded-ran.txt");
      const scriptPath = join(process.cwd(), "test", "helpers", "hook-probe.mjs");
      const hookCmd = `node ${scriptPath} supersede-destroy "${grove.poolDir}" "${wtPath}" "${sentinel}"`;

      const groveWithHook = await createGrove({
        repoRoot: repoDir,
        groveRoot: groveDir,
        hooks: {
          preDestroy: [hookCmd],
        },
      });

      await groveWithHook.destroy(wtPath, { force: true });

      const content = await readFile(sentinel, "utf8");
      expect(content.trim()).toBe("superseded");
      expect(existsSync(wtPath)).toBe(true);

      const list = await groveWithHook.list();
      expect(list).toHaveLength(1);
      expect(list[0]?.path).toBe(wtPath);
      expect(list[0]?.status).toBe("available");
    });

    it("destroyAll preserves worktree acquired by hook", async () => {
      const { repoDir, tmpDir, groveDir } = await setupRepo();
      tmpDirs.push(tmpDir);

      const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
      await grove.acquire();
      await grove.acquire();

      const sentinel = join(tmpDir, "acquired.txt");
      const scriptPath = join(process.cwd(), "test", "helpers", "hook-probe.mjs");
      const hookCmd = `node ${scriptPath} acquire-during-hook "${repoDir}" "${grove.poolDir}" "${sentinel}"`;

      const groveWithHook = await createGrove({
        repoRoot: repoDir,
        groveRoot: groveDir,
        hooks: {
          preDestroy: [hookCmd],
        },
      });

      await groveWithHook.destroyAll({ force: true });

      const hookAcquired = (await readFile(sentinel, "utf8")).trim();
      expect(existsSync(hookAcquired)).toBe(true);

      const list = await groveWithHook.list();
      expect(list).toHaveLength(1);
      expect(list[0]?.path).toBe(hookAcquired);
    });

    it("destroyAll preserves superseded reservation after hook", async () => {
      const { repoDir, tmpDir, groveDir } = await setupRepo();
      tmpDirs.push(tmpDir);

      const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
      const { path: wtPath } = await grove.acquire();
      await grove.release(wtPath);

      const sentinel = join(tmpDir, "superseded-ran.txt");
      const scriptPath = join(process.cwd(), "test", "helpers", "hook-probe.mjs");
      const hookCmd = `node ${scriptPath} supersede-destroy "${grove.poolDir}" "${wtPath}" "${sentinel}"`;

      const groveWithHook = await createGrove({
        repoRoot: repoDir,
        groveRoot: groveDir,
        hooks: {
          preDestroy: [hookCmd],
        },
      });

      await groveWithHook.destroyAll({ force: true });

      const content = await readFile(sentinel, "utf8");
      expect(content.trim()).toBe("superseded");
      expect(existsSync(wtPath)).toBe(true);

      const list = await groveWithHook.list();
      expect(list).toHaveLength(1);
      expect(list[0]?.path).toBe(wtPath);
    });

    it("destroyAll non-force rejects live destroying worktree", async () => {
      const { repoDir, tmpDir, groveDir } = await setupRepo();
      tmpDirs.push(tmpDir);

      const grove = await createGrove({ repoRoot: repoDir, groveRoot: groveDir });
      const { path: wtPath } = await grove.acquire();
      await grove.release(wtPath);

      const stateFile = join(grove.poolDir, "grove-state.json");
      const data = await readFile(stateFile, "utf8");
      const state = JSON.parse(data);
      state.worktrees[0].destroying = true;
      state.worktrees[0].owner_pid = process.pid;
      const start = await startedAt(process.pid);
      if (start) state.worktrees[0].owner_started_at = start;
      await writeFile(stateFile, JSON.stringify(state, null, 2));

      await expect(grove.destroyAll()).rejects.toThrow(/is in use by an agent/);
      expect(existsSync(wtPath)).toBe(true);
    });
  });
});
