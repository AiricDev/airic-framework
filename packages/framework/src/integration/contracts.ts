import type { DomainBindingRef, VersionedRef } from "../domain/work.js";

export type JsonSchema = Readonly<Record<string, unknown>>;
export type CapabilityKind = "query" | "compute" | "command";

export interface SourceLocator {
  path: string;
  symbol?: string;
  digest?: string;
}

export interface TrustedCallContext {
  actor: { id: string; scopes: readonly string[] };
  workId: string;
  workType: { moduleId: string; workTypeId: string; operatingDigest: string };
  actionId?: string;
  commandId?: string;
  expectedDomainRelease: string;
  targetRevision?: string;
  authorization?: unknown;
}

export interface CommandReceipt {
  commandId: string;
  status: "committed" | "pending" | "rejected";
  revision?: string;
  result?: unknown;
  error?: { code: string; message: string; details?: unknown };
}

export interface CommandInspection extends CommandReceipt {
  observedAt: string;
}

export interface CapabilityBinding {
  id: string;
  title: string;
  description: string;
  kind: CapabilityKind;
  source: SourceLocator;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  invoke(context: TrustedCallContext, input: unknown): Promise<unknown>;
}

export interface DomainProvider {
  id: string;
  moduleId: string;
  release: string;
  buildId: string;
  sourceBundle: VersionedRef & { digest: string };
  readme: SourceLocator;
  capabilities: readonly CapabilityBinding[];
  readSource?(locator: SourceLocator): Promise<{ content: string; locator: SourceLocator }>;
  inspectCommand?(context: TrustedCallContext, commandId: string): Promise<CommandInspection | undefined>;
}

export function bindingRef(module: DomainProvider): DomainBindingRef {
  return { id: module.id, release: module.release, buildId: module.buildId, sourceDigest: module.sourceBundle.digest };
}

export class DomainInvocationError extends Error {
  constructor(
    message: string,
    readonly outcome: "not-applied" | "unknown",
    readonly code = "DomainInvocationFailed",
    readonly details?: unknown,
  ) {
    super(message);
  }
}
