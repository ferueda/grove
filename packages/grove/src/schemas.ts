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

/** Lease-first persisted cleanup intent; reset requires an explicit resetTo target. */
export const LeaseFirstCleanupIntentSchema = z.discriminatedUnion("cleanup", [
  z.object({ cleanup: z.literal("preserve") }),
  z.object({
    cleanup: z.literal("reset"),
    resetTo: z.string(),
    force: z.boolean().optional(),
    cleanIgnored: z.boolean().optional(),
  }),
  z.object({ cleanup: z.literal("quarantine") }),
]);

export type LeaseFirstCleanupIntent = z.infer<typeof LeaseFirstCleanupIntentSchema>;

export const LeaseIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/, "Invalid lease ID format");

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

// --- Lease-first v1 state model (slots + leases) ---

export const ProcessInfoSchema = z.object({
  PID: z.number(),
  Name: z.string().optional(),
});

export type ProcessInfoRecord = z.infer<typeof ProcessInfoSchema>;

export const ProcessSafetyDiagnosticSchema = z.object({
  status: z.enum(["verified", "unverified"]),
  checkedAt: z.string(),
  processes: z.array(ProcessInfoSchema).optional(),
});

export type ProcessSafetyDiagnostic = z.infer<typeof ProcessSafetyDiagnosticSchema>;

export const BranchLeaseTargetSchema = z.object({
  mode: z.literal("branch"),
  branch: z.string(),
  requestedRef: z.string(),
  resolvedRefSha: z.string().optional(),
  branchHeadShaAtAcquire: z.string().optional(),
  createFromRef: z.string().optional(),
  createFromSha: z.string().optional(),
});

export const DetachedLeaseTargetSchema = z.object({
  mode: z.literal("detached"),
  requestedRef: z.string(),
  resolvedRefSha: z.string(),
});

export const GroveLeaseTargetSchema = z.discriminatedUnion("mode", [
  BranchLeaseTargetSchema,
  DetachedLeaseTargetSchema,
]);

export type GroveLeaseTarget = z.infer<typeof GroveLeaseTargetSchema>;

export const PendingAcquireSchema = z.object({
  target: GroveLeaseTargetSchema,
  startedAt: z.string(),
});

export type PendingAcquire = z.infer<typeof PendingAcquireSchema>;

export const GroveSlotSchema = z.object({
  slotName: z.string(),
  path: z.string(),
  state: z.enum(["available", "leased", "quarantined", "destroying"]),
  lastProcessSafetyCheck: ProcessSafetyDiagnosticSchema.optional(),
  ownerPid: z.number().optional(),
  ownerStartedAt: z.number().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type GroveSlot = z.infer<typeof GroveSlotSchema>;

export const GroveFailedPhaseSchema = z.enum(["postCreate", "checkout", "preRelease", "reset"]);

export type GroveFailedPhase = z.infer<typeof GroveFailedPhaseSchema>;

export const GroveLeaseDiagnosticsSchema = z.object({
  missingPath: z.boolean().optional(),
  lastProcessSafetyCheck: ProcessSafetyDiagnosticSchema.optional(),
  quarantineReason: z.string().optional(),
  failedPhase: GroveFailedPhaseSchema.optional(),
});

export type GroveLeaseDiagnostics = z.infer<typeof GroveLeaseDiagnosticsSchema>;

export const GroveLeaseSchema = z
  .object({
    leaseId: LeaseIdSchema,
    ownerId: z.string().optional(),
    slotName: z.string(),
    path: z.string(),
    repoRoot: z.string(),
    target: GroveLeaseTargetSchema.optional(),
    acquiredHeadSha: z.string().optional(),
    currentHeadSha: z.string().optional(),
    state: z.enum(["preparing", "leased", "releasing", "destroying", "quarantined"]),
    pendingAcquire: PendingAcquireSchema.optional(),
    pendingCleanup: LeaseFirstCleanupIntentSchema.optional(),
    diagnostics: GroveLeaseDiagnosticsSchema.optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((lease, ctx) => {
    if (lease.state === "preparing" && !lease.pendingAcquire) {
      ctx.addIssue({
        code: "custom",
        message: "preparing lease requires pendingAcquire",
        path: ["pendingAcquire"],
      });
    }
    if (lease.state === "leased") {
      if (!lease.target) {
        ctx.addIssue({
          code: "custom",
          message: "leased lease requires target",
          path: ["target"],
        });
      }
      if (lease.target?.mode === "branch") {
        if (!lease.target.resolvedRefSha) {
          ctx.addIssue({
            code: "custom",
            message: "leased branch lease requires resolvedRefSha",
            path: ["target", "resolvedRefSha"],
          });
        }
        if (!lease.target.branchHeadShaAtAcquire) {
          ctx.addIssue({
            code: "custom",
            message: "leased branch lease requires branchHeadShaAtAcquire",
            path: ["target", "branchHeadShaAtAcquire"],
          });
        }
      }
      if (!lease.acquiredHeadSha) {
        ctx.addIssue({
          code: "custom",
          message: "leased lease requires acquiredHeadSha",
          path: ["acquiredHeadSha"],
        });
      }
      if (!lease.currentHeadSha) {
        ctx.addIssue({
          code: "custom",
          message: "leased lease requires currentHeadSha",
          path: ["currentHeadSha"],
        });
      }
    }
    if (lease.state === "releasing" && !lease.pendingCleanup) {
      ctx.addIssue({
        code: "custom",
        message: "releasing lease requires pendingCleanup",
        path: ["pendingCleanup"],
      });
    }
  });

export type GroveLeaseRecord = z.infer<typeof GroveLeaseSchema>;

export const LeaseFirstGroveStateSchema = z.object({
  slots: z.array(GroveSlotSchema),
  leases: z.array(GroveLeaseSchema),
});

export type LeaseFirstGroveState = z.infer<typeof LeaseFirstGroveStateSchema>;

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
  onHookFailure: z.enum(["ignore", "fail"]).optional().default("ignore"),
  fetchOnAcquire: z.boolean().optional().default(true),
});

export type GroveConfig = z.input<typeof GroveConfigSchema>;
