import { z } from "zod";

export const WorktreeEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  created_at: z.string(),
  destroying: z.boolean().optional(),
  owner_pid: z.number().optional(),
  owner_started_at: z.number().optional(),
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
  hooks: z
    .object({
      postCreate: z.array(z.string()).optional(),
      preDestroy: z.array(z.string()).optional(),
    })
    .optional(),
  fetchOnAcquire: z.boolean().optional().default(true),
});

export type GroveConfig = z.infer<typeof GroveConfigSchema>;
