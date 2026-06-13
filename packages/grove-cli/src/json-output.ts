import type { CliSuggestion } from "./suggestions.js";

export type JsonErrorEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
};

export type JsonSuccessExtras = {
  suggestions?: readonly CliSuggestion[];
};

export type JsonListExtras = JsonSuccessExtras & {
  count?: number;
  byState?: Record<string, number>;
  pool?: { used: number; max: number; available: number };
};

export type JsonLeaseEnvelope<T> = {
  ok: true;
  lease: T;
} & JsonSuccessExtras;

export type JsonResultEnvelope<T> = {
  ok: true;
  result: T;
} & JsonSuccessExtras;

export type JsonLeasesEnvelope<T> = {
  ok: true;
  leases: T;
} & JsonListExtras;

export type JsonStatusEnvelope<T> = {
  ok: true;
  repoRoot: string;
  poolDir: string;
  count: number;
  byState: Record<string, number>;
  pool: { used: number; max: number; available: number };
  leases: T;
} & JsonSuccessExtras;

export type JsonCommandsEnvelope = {
  ok: true;
  commands: readonly {
    name: string;
    description: string;
    usage: string;
    output: string;
  }[];
};

export function writeJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + "\n");
}

export function leaseEnvelope<T>(lease: T, extras?: JsonSuccessExtras): JsonLeaseEnvelope<T> {
  return { ok: true, lease, ...extras };
}

export function resultEnvelope<T>(result: T, extras?: JsonSuccessExtras): JsonResultEnvelope<T> {
  return { ok: true, result, ...extras };
}

export function leasesEnvelope<T>(leases: T, extras?: JsonListExtras): JsonLeasesEnvelope<T> {
  return { ok: true, leases, ...extras };
}

export function statusEnvelope<T>(
  repoRoot: string,
  poolDir: string,
  stats: { count: number; byState: Record<string, number>; pool: { used: number; max: number; available: number } },
  leases: T,
  extras?: JsonSuccessExtras,
): JsonStatusEnvelope<T> {
  return {
    ok: true,
    repoRoot,
    poolDir,
    count: stats.count,
    byState: stats.byState,
    pool: stats.pool,
    leases,
    ...extras,
  };
}

export function commandsEnvelope(
  commands: JsonCommandsEnvelope["commands"],
): JsonCommandsEnvelope {
  return { ok: true, commands };
}

export function errorEnvelope(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): JsonErrorEnvelope {
  return { ok: false, error: { code, message, details } };
}
