import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  getAgentDir,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { renderContextEnvelope, type AgentHarness, type ContextEnvelope, type DeliveryRecord, type HarnessEvent, type HarnessTool } from "@airic/framework";

export interface PiHarnessOptions {
  cwd: string;
  sessionDirectory: string;
  model?: { provider: string; id: string };
  authPath?: string;
  modelsPath?: string;
  apiKeys?: Readonly<Record<string, string>>;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
}

interface ActiveCall {
  envelope: ContextEnvelope;
  refreshContext(): Promise<ContextEnvelope>;
  onDelivered(record: DeliveryRecord): Promise<void>;
  onEvent(event: HarnessEvent): Promise<void>;
}
interface SessionBinding { session: AgentSession; active: ActiveCall; disposeSubscription: () => void }

export class PiHarness implements AgentHarness {
  static readonly adapterVersion = "0.1.0+pi-0.80.10";
  readonly #options: PiHarnessOptions;
  readonly #sessions = new Map<string, SessionBinding>();
  readonly #creating = new Map<string, Promise<SessionBinding>>();

  constructor(options: PiHarnessOptions) { this.#options = { ...options, cwd: resolve(options.cwd), sessionDirectory: resolve(options.sessionDirectory) }; }
  capabilities() { return { resume: true, interrupt: true, contextHook: true, compactionTrace: true }; }

  async run(input: {
    workId: string; message: string; envelope: ContextEnvelope; tools: readonly HarnessTool[]; refreshContext(): Promise<ContextEnvelope>; signal?: AbortSignal;
    onDelivered(record: DeliveryRecord): Promise<void>; onEvent(event: HarnessEvent): Promise<void>;
  }): Promise<{ text: string }> {
    const active: ActiveCall = { envelope: input.envelope, refreshContext: input.refreshContext, onDelivered: input.onDelivered, onEvent: input.onEvent };
    const binding = await this.#binding(input.workId, input.tools, active);
    binding.active = active;
    let text = "";
    const stop = binding.session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") text += event.assistantMessageEvent.delta;
    });
    const abort = () => binding.session.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      await binding.session.prompt(input.message);
      return { text };
    } finally {
      stop();
      input.signal?.removeEventListener("abort", abort);
    }
  }

  async interrupt(workId: string): Promise<void> { this.#sessions.get(workId)?.session.abort(); }
  async dispose(): Promise<void> {
    for (const binding of this.#sessions.values()) { binding.disposeSubscription(); binding.session.dispose(); }
    this.#sessions.clear();
  }

  async #binding(workId: string, tools: readonly HarnessTool[], active: ActiveCall): Promise<SessionBinding> {
    const existing = this.#sessions.get(workId);
    if (existing) return existing;
    const pending = this.#creating.get(workId);
    if (pending) return pending;
    const creation = this.#createBinding(workId, tools, active);
    this.#creating.set(workId, creation);
    try { const binding = await creation; this.#sessions.set(workId, binding); return binding; }
    finally { this.#creating.delete(workId); }
  }

  async #createBinding(workId: string, tools: readonly HarnessTool[], active: ActiveCall): Promise<SessionBinding> {
    const sessionDirectory = join(this.#options.sessionDirectory, workId);
    await mkdir(sessionDirectory, { recursive: true });
    const holder: { active: ActiveCall } = { active };
    const resourceLoader = new DefaultResourceLoader({
      cwd: this.#options.cwd,
      agentDir: getAgentDir(),
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: true }, retry: { enabled: true, maxRetries: 2 } }),
      systemPromptOverride: () => renderContextEnvelope(holder.active.envelope),
      extensionFactories: [{
        name: "airic-context-audit",
        factory: (pi) => {
          pi.on("context", async (event) => {
            holder.active.envelope = await holder.active.refreshContext();
            await holder.active.onEvent({ type: "context-change", payload: { hook: "context", envelopeDigest: holder.active.envelope.digest, messageCount: event.messages.length } });
          });
          pi.on("before_provider_request", async (event) => {
            await holder.active.onDelivered(describePiBridge(holder.active.envelope, tools, event.payload).delivery);
          });
          pi.on("session_before_compact", async (event) => {
            await holder.active.onEvent({ type: "context-change", payload: { hook: "session_before_compact", preparationDigest: digest(JSON.stringify(event.preparation)) } });
          });
          pi.on("session_compact", async (event) => {
            await holder.active.onEvent({ type: "context-change", payload: { hook: "session_compact", summaryDigest: digest(event.compactionEntry.summary) } });
          });
        },
      }],
    });
    await resourceLoader.reload();
    const modelRuntime = await ModelRuntime.create({ ...(this.#options.authPath ? { authPath: this.#options.authPath } : {}), ...(this.#options.modelsPath ? { modelsPath: this.#options.modelsPath } : {}) });
    for (const [provider, key] of Object.entries(this.#options.apiKeys ?? {})) await modelRuntime.setRuntimeApiKey(provider, key);
    const model = this.#options.model ? modelRuntime.getModel(this.#options.model.provider, this.#options.model.id) : undefined;
    if (this.#options.model && !model) throw new Error(`Pi model not found: ${this.#options.model.provider}/${this.#options.model.id}`);
    const customTools = tools.map((tool) => defineTool({
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: Type.Unsafe(tool.inputSchema),
      execute: async (toolCallId, params) => {
        try {
          const result = await tool.invoke(params, toolCallId);
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: { result, error: false } as { result: unknown; error: boolean } };
        } catch (error) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }], details: { result: undefined, error: true } as { result: unknown; error: boolean } };
        }
      },
    }));
    const created = await createAgentSession({
      cwd: this.#options.cwd,
      sessionManager: SessionManager.continueRecent(this.#options.cwd, sessionDirectory),
      resourceLoader,
      modelRuntime,
      customTools,
      noTools: "builtin",
      ...(model ? { model } : {}),
      ...(this.#options.thinking ? { thinkingLevel: this.#options.thinking } : {}),
    });
    const disposeSubscription = created.session.subscribe((event) => {
      if (event.type === "tool_execution_start") void holder.active.onEvent({ type: "tool", providerEventId: event.toolCallId, payload: { phase: "start", name: event.toolName } });
      if (event.type === "tool_execution_end") void holder.active.onEvent({ type: "tool", providerEventId: event.toolCallId, payload: { phase: "end", name: event.toolName, isError: event.isError } });
      if (event.type === "agent_settled") void holder.active.onEvent({ type: "status", payload: { state: "settled" } });
    });
    const binding: SessionBinding = { session: created.session, active: holder.active, disposeSubscription };
    Object.defineProperty(binding, "active", { get: () => holder.active, set: (value: ActiveCall) => { holder.active = value; } });
    return binding;
  }
}

export function describePiBridge(envelope: ContextEnvelope, tools: readonly HarnessTool[], providerPayload: unknown): { systemPrompt: string; delivery: DeliveryRecord; hooks: readonly string[] } {
  return {
    systemPrompt: renderContextEnvelope(envelope),
    delivery: {
      envelopeDigest: envelope.digest,
      adapter: { id: "pi", version: PiHarness.adapterVersion },
      injectionPoints: ["system-prompt", "custom-tools", "before-provider-request"],
      registeredTools: tools.map((tool) => tool.name),
      providerPayloadDigest: digest(JSON.stringify(providerPayload)),
      additionalContext: [{ kind: "pi-conversation-history", reviewable: true }],
    },
    hooks: ["context", "before_provider_request", "session_before_compact", "session_compact"],
  };
}

function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
