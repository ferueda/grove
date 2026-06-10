import { z } from 'zod';
import { resolveGroveDir } from './config.js';
import { Grove } from './pool.js';

export const GroveConfigSchema = z.object({
  repoRoot: z.string(),
  groveRoot: z.string().optional(),
  maxTrees: z.number().optional().default(16),
  hooks: z.object({
    postCreate: z.array(z.string()).optional(),
    preDestroy: z.array(z.string()).optional(),
  }).optional(),
});

export type GroveConfig = z.infer<typeof GroveConfigSchema>;

export async function createGrove(configInput: GroveConfig): Promise<Grove> {
  const config = GroveConfigSchema.parse(configInput);
  const groveDir = await resolveGroveDir(config.repoRoot, config.groveRoot || '');
  return new Grove(groveDir, config);
}
