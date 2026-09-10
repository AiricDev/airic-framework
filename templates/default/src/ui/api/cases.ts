import type { CaseRecord } from "../../domain/case.js";

export class AppApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "AppApiError"; }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/app${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = body as { error?: string; code?: string };
    throw new AppApiError(response.status, failure.code ?? "RequestFailed", failure.error ?? response.statusText);
  }
  return body as T;
}

export function listCases(): Promise<{ cases: CaseRecord[] }> { return request("/cases"); }
export function getCase(id: string): Promise<{ case: CaseRecord }> { return request(`/cases/${encodeURIComponent(id)}`); }

export interface CaseCommandInput { expectedRevision: number; changes: { customerName?: string; email?: string; markReady?: boolean } }
export interface CaseCommandReceipt { commandId: string; status: string; revision: string; record: CaseRecord }

export function sendCaseCommand(id: string, input: CaseCommandInput): Promise<{ receipt: CaseCommandReceipt }> {
  return request(`/cases/${encodeURIComponent(id)}/commands`, { method: "POST", body: JSON.stringify(input) });
}

export function inspectCaseCommand(commandId: string): Promise<{ receipt: CaseCommandReceipt }> {
  return request(`/commands/${encodeURIComponent(commandId)}`);
}
