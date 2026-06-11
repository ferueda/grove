import { z } from "zod";

export const GroveCleanupIntentSchema = z.discriminatedUnion("cleanup", [
  z.object({ cleanup: z.literal("preserve") }),
  z.object({
    cleanup: z.literal("reset"),
    resetTo: z.string().optional(),
    force: z.boolean().optional(),
    cleanIgnored: z.boolean().optional(),
  }),
  z.object({ cleanup: z.literal("quarantine") }),
]);

export type GroveCleanupIntent = z.infer<typeof GroveCleanupIntentSchema>;

export const LeaseIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/, "Invalid lease ID format");

export const WorktreeEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  created_at: z.string(),
  destroying: z.boolean().optional(),
  owner_pid: z.number().optional(),
  owner_started_at: z.number().optional(),

  // Lease Mode fields
  leaseId: LeaseIdSchema.optional(),
  ownerId: z.string().optional(),
  baseRef: z.string().optional(),
  baseSha: z.string().optional(),
  acquiredHeadSha: z.string().optional(),
  currentHeadSha: z.string().optional(),
  branch: z.string().optional(),
  state: z.enum(["leased", "available", "releasing", "destroying", "quarantined"]).optional(),
  pendingCleanup: GroveCleanupIntentSchema.optional(),
  processSafety: z.enum(["verified", "unverified"]).optional(),
  updatedAt: z.string().optional(),
});

export type WorktreeEntry = z.infer<typeof WorktreeEntrySchema>;

export const GroveStateSchema = z.object({
  worktrees: z.array(WorktreeEntrySchema),
});

export type GroveState = z.infer<typeof GroveStateSchema>;

export const GroveConfigSchema = z.object({
  repoRoot: z.string(),
  groveDir: z.string().optional(),
  groveRoot: z.string().optional(),
  maxTrees: z.number().optional().default(16),
  safeDeleteBranchPrefixes: z.array(z.string()).optional(),
  hookTimeoutMs: z.number().optional(),
  hooks: z
    .object({
      postCreate: z.array(z.string()).optional(),
      postAcquire: z.array(z.string()).optional(),
      preRelease: z.array(z.string()).optional(),
      postRelease: z.array(z.string()).optional(),
      preDestroy: z.array(z.string()).optional(),
    })
    .optional(),
  fetchOnAcquire: z.boolean().optional().default(true),
});

export type GroveConfig = z.input<typeof GroveConfigSchema>;
