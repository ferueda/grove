import type { GroveLease, GrovePoolStats, ReleaseResult, RepairResult } from "@ferueda/grove";

export type CliSuggestion = {
  command: string;
  reason: string;
};

export function suggestionsForLease(lease: GroveLease): CliSuggestion[] {
  const id = lease.leaseId;
  switch (lease.state) {
    case "leased":
      return [
        {
          command: `grove inspect --json --lease-id ${id}`,
          reason: "Inspect this lease for full details.",
        },
        {
          command: `grove release --json --lease-id ${id} --cleanup preserve`,
          reason: "Release this leased worktree when the caller is done.",
        },
      ];
    case "preparing":
      return [
        {
          command: `grove repair --json --lease-id ${id} --action resume-acquire`,
          reason: "Resume a stuck acquire for this lease.",
        },
      ];
    case "releasing":
      return [
        {
          command: `grove repair --json --lease-id ${id} --action resume-cleanup`,
          reason: "Resume a stuck release cleanup for this lease.",
        },
      ];
    case "quarantined":
      return [
        {
          command: `grove repair --json --lease-id ${id} --action force-destroy --force`,
          reason: "Force-destroy a quarantined lease to reclaim pool capacity.",
        },
        {
          command: `grove inspect --json --lease-id ${id}`,
          reason: "Inspect this quarantined lease for diagnostics.",
        },
      ];
    case "destroying":
      return [
        {
          command: `grove repair --json --lease-id ${id} --action force-destroy --force`,
          reason: "Force-destroy a lease stuck in destroying state.",
        },
      ];
  }
}

export function suggestionsForReleaseResult(result: ReleaseResult): CliSuggestion[] {
  switch (result.status) {
    case "preserved":
      return [
        {
          command: `grove inspect --json --lease-id ${result.leaseId}`,
          reason: "Inspect the preserved lease.",
        },
        {
          command: `grove destroy --json --lease-id ${result.leaseId}`,
          reason: "Destroy the preserved lease when no longer needed.",
        },
      ];
    case "quarantined":
      return [
        {
          command: `grove repair --json --lease-id ${result.leaseId} --action force-destroy --force`,
          reason: "Force-destroy a quarantined lease to reclaim pool capacity.",
        },
        {
          command: `grove inspect --json --lease-id ${result.leaseId}`,
          reason: "Inspect this quarantined lease for diagnostics.",
        },
      ];
    case "released":
      return [
        {
          command: "grove list --json",
          reason: "List current leases after release.",
        },
      ];
  }
}

export function suggestionsForRepairResult(result: RepairResult): CliSuggestion[] {
  switch (result.status) {
    case "quarantined":
      return suggestionsForLease(result.lease);
    case "destroyed":
      return suggestionsForDestroyedLease(result.leaseId);
  }
}

export function suggestionsForList(stats: GrovePoolStats): CliSuggestion[] {
  const suggestions: CliSuggestion[] = [];

  if ((stats.byState.quarantined ?? 0) > 0) {
    suggestions.push({
      command: "grove list --json",
      reason: "Review quarantined leases and use repair force-destroy when appropriate.",
    });
  }
  if ((stats.byState.preparing ?? 0) > 0) {
    suggestions.push({
      command: "grove list --json",
      reason: "Review preparing leases and use repair resume-acquire when stuck.",
    });
  }
  if (stats.count > 0) {
    suggestions.push({
      command: "grove inspect --json --lease-id <leaseId>",
      reason: "Inspect a lease for full details.",
    });
  }
  if (stats.pool.available === 0) {
    suggestions.push({
      command: "grove status --json",
      reason: "Pool is at capacity; release or destroy leases to free slots.",
    });
  }

  return suggestions;
}

export function suggestionsForDestroyedLease(leaseId: string): CliSuggestion[] {
  return [
    {
      command: "grove list --json",
      reason: `Lease ${leaseId} was destroyed; list remaining leases.`,
    },
    {
      command: "grove status --json",
      reason: "Check pool capacity and active leases.",
    },
  ];
}
