export type ActionStatus = "prepared" | "pending" | "committed" | "rejected" | "failed" | "unknown";

export interface Action {
  id: string;
  workId: string;
  requestId: string;
  commandId: string;
  domainId: string;
  domainRelease: string;
  capabilityId: string;
  payloadDigest: string;
  status: ActionStatus;
  receipt?: unknown;
  error?: { code: string; message: string; details?: unknown };
  createdAt: string;
  updatedAt: string;
}

export function prepareAction(input: Omit<Action, "status" | "createdAt" | "updatedAt"> & { now: string }): Action {
  return { ...input, status: "prepared", createdAt: input.now, updatedAt: input.now };
}

export function settleAction(action: Action, status: Exclude<ActionStatus, "prepared">, now: string, details: { receipt?: unknown; error?: Action["error"] } = {}): Action {
  if (["committed", "rejected", "failed"].includes(action.status)) return action;
  return {
    ...action,
    status,
    updatedAt: now,
    ...(details.receipt !== undefined ? { receipt: details.receipt } : {}),
    ...(details.error ? { error: details.error } : {}),
  };
}
