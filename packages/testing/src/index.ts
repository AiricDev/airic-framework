import type { AgentHarness, ContextEnvelope, DeliveryRecord, HarnessEvent, HarnessTool } from "@airic/framework";

export interface FakeHarnessStep {
  text?: string;
  call?: { tool: string; input: unknown; requestId: string };
  event?: HarnessEvent;
  result?: unknown;
}

export class FakeHarness implements AgentHarness {
  readonly delivered: DeliveryRecord[] = [];
  readonly envelopes: ContextEnvelope[] = [];
  readonly calls: { workId: string; message: string }[] = [];
  #scripts: FakeHarnessStep[][] = [];

  enqueue(...steps: FakeHarnessStep[]): this { this.#scripts.push(steps); return this; }
  capabilities() { return { resume: true, interrupt: true, contextHook: true, compactionTrace: true }; }
  async run(input: {
    workId: string; message: string; envelope: ContextEnvelope; tools: readonly HarnessTool[]; refreshContext(): Promise<ContextEnvelope>; signal?: AbortSignal;
    onDelivered(record: DeliveryRecord): Promise<void>; onEvent(event: HarnessEvent): Promise<void>;
  }): Promise<{ text: string; result?: unknown }> {
    this.envelopes.push(input.envelope); this.calls.push({ workId: input.workId, message: input.message });
    const delivery: DeliveryRecord = { envelopeDigest: input.envelope.digest, adapter: { id: "fake", version: "1" }, injectionPoints: ["system-prompt", "tool-registry"], registeredTools: input.tools.map((tool) => tool.name) };
    this.delivered.push(delivery); await input.onDelivered(delivery);
    const script = this.#scripts.shift() ?? [{ text: "The simulated agent is ready." }];
    let text = ""; let result: unknown;
    for (const step of script) {
      if (input.signal?.aborted) throw new Error("Harness interrupted");
      if (step.event) await input.onEvent(step.event);
      if (step.call) {
        const tool = input.tools.find((candidate) => candidate.name === step.call!.tool);
        if (!tool) throw new Error(`FakeHarness cannot find tool ${step.call.tool}`);
        result = await tool.invoke(step.call.input, step.call.requestId);
        await input.onEvent({ type: "tool", payload: { phase: "end", name: step.call.tool, requestId: step.call.requestId, isError: false, result } });
        const refreshed = await input.refreshContext();
        this.envelopes.push(refreshed);
        const refreshedDelivery: DeliveryRecord = { ...delivery, envelopeDigest: refreshed.digest };
        this.delivered.push(refreshedDelivery);
        await input.onDelivered(refreshedDelivery);
      }
      if (step.text) text += step.text;
      if (step.result !== undefined) result = step.result;
    }
    return result === undefined ? { text } : { text, result };
  }
  async interrupt(): Promise<void> {}
}

export class MemoryRuntimeStore {
  readonly events: import("@airic/framework").RuntimeEvent[] = [];
  readonly objects = new Map<string, Uint8Array>();
  async open(): Promise<void> {}
  async close(): Promise<void> {}
  async append(events: readonly import("@airic/framework").RuntimeEvent[]): Promise<void> { this.events.push(...events); }
  async *replay(): AsyncIterable<import("@airic/framework").RuntimeEvent> { yield* this.events; }
  async putObject(content: Uint8Array): Promise<{ digest: string; size: number }> { const digest = String(this.objects.size).padStart(64, "0"); this.objects.set(digest, content); return { digest, size: content.byteLength }; }
  async getObject(digest: string): Promise<Uint8Array> { const value = this.objects.get(digest); if (!value) throw new Error("Missing object"); return value; }
}

export class MemoryDefinitionSource {
  constructor(readonly definitions: Record<string, { manifest: unknown; documents: Record<string, string> }>) {}
  async readManifest(id: string): Promise<unknown> { return this.definitions[id]?.manifest ?? missing(id); }
  async readDocument(id: string, path: string): Promise<string> { return this.definitions[id]?.documents[path] ?? missing(`${id}/${path}`); }
  async listDefinitionFiles(id: string): Promise<readonly string[]> { return ["work.yml", ...Object.keys(this.definitions[id]?.documents ?? {})]; }
}
function missing(id: string): never { throw new Error(`Missing fixture ${id}`); }
