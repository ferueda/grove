import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runHooks } from "../src/hooks.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";

describe("Hooks", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "grove-test-hooks-"));
  });

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("runs sequential commands in workDir", async () => {
    const commands = ['echo "hello" > test1.txt', 'echo "world" > test2.txt'];

    await runHooks(commands, tmpDir);

    const f1 = await readFile(join(tmpDir, "test1.txt"), "utf8");
    const f2 = await readFile(join(tmpDir, "test2.txt"), "utf8");

    expect(f1.trim()).toBe("hello");
    expect(f2.trim()).toBe("world");
  });

  it("first command fails but second still runs, without throwing", async () => {
    const commands = ["nonexistentbinary123", 'echo "survivor" > test.txt'];

    let stderrOutput = "";
    const mockStderr = new Writable({
      write(chunk, enc, cb) {
        stderrOutput += chunk.toString();
        cb();
      },
    });

    // Should not throw
    await runHooks(commands, tmpDir, { stderr: mockStderr });

    const content = await readFile(join(tmpDir, "test.txt"), "utf8");
    expect(content.trim()).toBe("survivor");

    // Should log the error for the first command
    expect(stderrOutput).toContain("hook command failed");
    expect(stderrOutput).toContain("nonexistentbinary123");
  });
});
