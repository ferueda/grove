import { afterEach, beforeEach } from "vitest";
import { rm } from "node:fs/promises";

export interface LeaseIntegrationCleanup {
  tmpDirs: string[];
}

export function registerLeaseIntegrationCleanup(): LeaseIntegrationCleanup {
  const state: LeaseIntegrationCleanup = { tmpDirs: [] };

  beforeEach(() => {
    state.tmpDirs = [];
  });

  afterEach(async () => {
    for (const dir of state.tmpDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  return state;
}

export function failOnceHook(counterPath: string): string {
  const script =
    "const fs = require('node:fs'); const p = process.argv[1]; const n = fs.existsSync(p) ? Number(fs.readFileSync(p, 'utf8')) : 0; fs.writeFileSync(p, String(n + 1)); if (n === 0) process.exit(1);";
  return ["node", "-e", JSON.stringify(script), JSON.stringify(counterPath)].join(" ");
}
