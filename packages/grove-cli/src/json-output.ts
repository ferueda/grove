export type JsonErrorEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
};

export type JsonLeaseEnvelope<T> = {
  ok: true;
  lease: T;
};

export type JsonResultEnvelope<T> = {
  ok: true;
  result: T;
};

export type JsonLeasesEnvelope<T> = {
  ok: true;
  leases: T;
};

export function writeJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + "\n");
}

export function leaseEnvelope<T>(lease: T): JsonLeaseEnvelope<T> {
  return { ok: true, lease };
}

export function resultEnvelope<T>(result: T): JsonResultEnvelope<T> {
  return { ok: true, result };
}

export function leasesEnvelope<T>(leases: T): JsonLeasesEnvelope<T> {
  return { ok: true, leases };
}

export function errorEnvelope(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): JsonErrorEnvelope {
  return { ok: false, error: { code, message, details } };
}
