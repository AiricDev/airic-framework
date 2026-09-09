export type CaseStatus = "draft" | "ready";

export interface CaseRecord {
  id: string;
  customerName?: string;
  email?: string;
  status: CaseStatus;
  revision: number;
}

export class CasePolicyError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

export function updateCase(
  current: CaseRecord,
  changes: { customerName?: string; email?: string; markReady?: boolean },
  expectedRevision: number,
): CaseRecord {
  if (current.revision !== expectedRevision) {
    throw new CasePolicyError("RevisionConflict", `Expected revision ${expectedRevision}, found ${current.revision}`);
  }
  const next = {
    ...current,
    ...(changes.customerName ? { customerName: changes.customerName.trim() } : {}),
    ...(changes.email ? { email: changes.email.trim().toLowerCase() } : {}),
  };
  if (next.email && !/^\S+@\S+\.\S+$/.test(next.email)) {
    throw new CasePolicyError("InvalidEmail", "A valid email address is required");
  }
  if (changes.markReady && (!next.customerName || !next.email)) {
    throw new CasePolicyError("RequiredInformationMissing", "Customer name and email are required before the case is ready", {
      missing: [!next.customerName && "customerName", !next.email && "email"].filter(Boolean),
    });
  }
  return { ...next, status: changes.markReady ? "ready" : next.status, revision: current.revision + 1 };
}
