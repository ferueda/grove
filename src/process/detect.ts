import type { WorktreeEntry } from '../schemas.js';

// Stub for Phase 2; will be fully implemented in Phase 3
export async function ownerAlive(entry: WorktreeEntry): Promise<boolean> {
  if (entry.owner_pid === -1) {
    return false; // Magic number for testing dead PIDs in Phase 2
  }
  return true;
}
