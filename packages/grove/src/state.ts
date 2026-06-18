import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { GroveStateSchema } from "./schemas.js";
import type { GroveState } from "./schemas.js";
import { InvalidGroveStateError } from "./errors.js";
import { ownerAlive } from "./process/detect.js";
import { existsSync } from "node:fs";

export function stateFilePath(groveDir: string): string {
  return join(groveDir, "grove-state.json");
}

export async function readState(groveDir: string): Promise<GroveState> {
  let data: string;
  try {
    data = await readFile(stateFilePath(groveDir), "utf8");
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return { worktrees: [] };
    }
    throw error;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new InvalidGroveStateError("Invalid JSON format");
  }

  const result = GroveStateSchema.safeParse(parsed);
  if (!result.success) {
    throw new InvalidGroveStateError("State validation failed");
  }

  return result.data;
}

export async function writeState(groveDir: string, state: GroveState): Promise<void> {
  const data = JSON.stringify(state, null, 2);
  const target = stateFilePath(groveDir);
  const tmp = `${target}.tmp`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, target);
}

export async function healState(state: GroveState): Promise<GroveState> {
  const healed: GroveState = { worktrees: [] };

  for (const entry of state.worktrees) {
    if (!existsSync(entry.path)) {
      continue; // drop entries where path does not exist on disk
    }

    if (entry.owner_pid !== undefined) {
      if (!(await ownerAlive(entry))) {
        // clear owner fields
        const { owner_pid: _p, owner_started_at: _s, destroying: _d, ...rest } = entry;
        healed.worktrees.push(rest);
        continue;
      }
    }

    healed.worktrees.push(entry);
  }

  for (const entry of healed.worktrees) {
    if (!entry.state) {
      entry.state = "available";
    }
  }

  return healed;
}
