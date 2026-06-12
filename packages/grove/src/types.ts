import type {
  GroveCleanupIntent,
  GroveLeaseDiagnostics,
  GroveLeaseTarget,
  PendingAcquire,
} from "./schemas.js";

export type WorktreeStatusInfo = "available" | "dirty" | "in-use" | "you're here";

export interface AcquiredSlot {
  readonly path: string;
  readonly name: string;
}

export interface WorktreeStatus {
  name: string;
  path: string;
  status: WorktreeStatusInfo;
  processes: { PID: number; Name?: string }[];
}

type AcquireMode =
  | {
      mode: "branch";
      branch: string;
      createBranch?: {
        from: string;
        ifExists?: "reuse" | "fail";
      };
    }
  | {
      mode: "detached";
      ref: string;
    };

export type AcquireLeaseOptions = AcquireMode & {
  leaseId: string;
  ownerId?: string;
  ifLeased?: "return-existing" | "fail";
  fetchOnAcquire?: boolean;
  metadata?: Record<string, string>;
};

export type ReleaseLeaseOptions = GroveCleanupIntent;

export type ReleaseResult =
  | { status: "preserved"; leaseId: string; lease: GroveLease }
  | { status: "released"; leaseId: string; slotName: string; path: string }
  | { status: "quarantined"; leaseId: string; lease: GroveLease };

export function isReleaseResult(value: unknown): value is ReleaseResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    (value.status === "preserved" ||
      value.status === "released" ||
      value.status === "quarantined")
  );
}

export type RepairResult =
  | { status: "quarantined"; leaseId: string; lease: GroveLease }
  | { status: "destroyed"; leaseId: string };

export function isRepairResult(value: unknown): value is RepairResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    (value.status === "quarantined" || value.status === "destroyed")
  );
}

export interface DestroyLeaseOptions {
  force?: boolean;
  deleteBranch?: boolean;
}

export interface RepairLeaseOptions {
  leaseId: string;
  action: "quarantine" | "resume-acquire" | "resume-cleanup" | "force-destroy";
  force?: boolean;
}

export interface GroveLease {
  leaseId: string;
  ownerId?: string | undefined;
  slotName: string;
  path: string;
  repoRoot: string;
  branch?: string | undefined;
  baseRef?: string | undefined;
  baseSha?: string | undefined;
  target?: GroveLeaseTarget | undefined;
  acquiredHeadSha: string;
  currentHeadSha: string;
  state:
    | "preparing"
    | "leased"
    | "releasing"
    | "destroying"
    | "quarantined";
  pendingAcquire?: PendingAcquire | undefined;
  pendingCleanup?: GroveCleanupIntent | undefined;
  diagnostics?: GroveLeaseDiagnostics | undefined;
  metadata?: Record<string, string> | undefined;
  processSafety?: "verified" | "unverified" | undefined;
  createdAt: string;
  updatedAt: string;
}
