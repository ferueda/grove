#!/usr/bin/env node
import { spawn } from "node:child_process";

const child = spawn("pnpm", ["exec", "vitest", "run", "--reporter=verbose"], {
  stdio: ["inherit", "pipe", "pipe"],
  shell: true,
});

let stdout = "";
child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  stdout += text;
  process.stdout.write(text);
});
child.stderr.on("data", (chunk) => process.stderr.write(chunk));

child.on("close", (code) => {
  printReport(stdout);
  process.exit(code ?? 1);
});

function printReport(output) {
  const tests = [];
  const fileTimes = new Map();

  for (const line of output.split("\n")) {
    const testMatch = line.match(/✓\s+(.+?)\s+(\d+)ms$/);
    if (testMatch) {
      const [, name, ms] = testMatch;
      const duration = Number(ms);
      tests.push({ name, duration });
      continue;
    }

    const fileMatch = line.match(/✓\s+(.+\.test\.ts)\s+\((\d+)\s+tests?\)\s+(\d+)ms$/);
    if (fileMatch) {
      const [, file, , ms] = fileMatch;
      fileTimes.set(file, Number(ms));
    }
  }

  const wallMatch = output.match(/Duration\s+([\d.]+)s/);
  const wallSeconds = wallMatch ? Number(wallMatch[1]) : undefined;

  console.log("\n--- Grove test timing report ---");
  if (wallSeconds !== undefined) {
    console.log(`Wall time: ${wallSeconds.toFixed(2)}s`);
  }

  console.log("\nSlowest tests:");
  for (const entry of [...tests].sort((a, b) => b.duration - a.duration).slice(0, 15)) {
    console.log(`  ${(entry.duration / 1000).toFixed(2)}s  ${entry.name}`);
  }

  console.log("\nAggregate time by file:");
  for (const [file, ms] of [...fileTimes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${(ms / 1000).toFixed(2)}s  ${file}`);
  }
}
