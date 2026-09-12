import type { Action } from "../domain/action.js";
import type { Work } from "../domain/work.js";
import type { ContextEnvelope } from "./context.js";
import type { WorkTypeRef } from "../domain/work.js";

export interface TraceEvent {
  schemaVersion: 1;
  eventId: string;
  workId: string;
  actionId?: string;
  type: `${"work" | "action" | "context" | "message" | "tool" | "harness" | "reflection"}.${string}`;
  timestamp: string;
  actor: string;
  parentEventId?: string;
  payload: unknown;
}

export type RuntimeEvent =
  | { kind: "work.saved"; work: Work }
  | { kind: "action.saved"; action: Action }
  | { kind: "trace.appended"; event: TraceEvent };

export interface RuntimeStore {
  open(): Promise<void>;
  close(): Promise<void>;
  append(events: readonly RuntimeEvent[]): Promise<void>;
  replay(): AsyncIterable<RuntimeEvent>;
  putObject(content: Uint8Array): Promise<{ digest: string; size: number }>;
  getObject(digest: string): Promise<Uint8Array>;
}

export interface HarnessTool {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  invoke(input: unknown, requestId: string): Promise<unknown>;
}

export interface HarnessEvent {
  type: "message" | "tool" | "context-change" | "status";
  payload: unknown;
  providerEventId?: string;
}

export interface DeliveryRecord {
  envelopeDigest: string;
  adapter: { id: string; version: string };
  injectionPoints: readonly string[];
  registeredTools: readonly string[];
  providerPayloadDigest?: string;
  additionalContext?: readonly { kind: string; digest?: string; reviewable: boolean }[];
}

export interface AgentHarness {
  capabilities(): { resume: boolean; interrupt: boolean; contextHook: boolean; compactionTrace: boolean; workspaceWorkTypes?: readonly string[] };
  run(input: {
    workId: string;
    workInput: unknown;
    message: string;
    envelope: ContextEnvelope;
    tools: readonly HarnessTool[];
    refreshContext(): Promise<ContextEnvelope>;
    signal?: AbortSignal;
    onDelivered(record: DeliveryRecord): Promise<void>;
    onEvent(event: HarnessEvent): Promise<void>;
  }): Promise<{ text: string; result?: unknown }>;
  interrupt?(workId: string): Promise<void>;
}

export interface WorkTypeSource {
  listModules(): Promise<readonly string[]>;
  readModuleManifest(moduleId: string): Promise<unknown>;
  readManifest(ref: WorkTypeRef & { packagePath: string }): Promise<unknown>;
  readDocument(ref: WorkTypeRef & { packagePath: string }, path: string): Promise<string>;
  listWorkTypeFiles(ref: WorkTypeRef & { packagePath: string }): Promise<readonly string[]>;
  status?(): Promise<{ gitHead?: string; dirty: boolean }>;
}
