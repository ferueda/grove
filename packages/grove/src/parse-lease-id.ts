import { InvalidInputError } from "./errors.js";
import { LeaseIdSchema } from "./schemas.js";

export function parseLeaseId(leaseId: string): string {
  const parsed = LeaseIdSchema.safeParse(leaseId);
  if (!parsed.success) {
    throw new InvalidInputError("Invalid lease ID format");
  }
  return parsed.data;
}
