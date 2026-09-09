import { randomUUID } from "node:crypto";
import { prepareAction, settleAction, type Action } from "../domain/action.js";
import { createWork, reviseWork, type Work } from "../domain/work.js";
import { bindingRef, DomainInvocationError, type CommandReceipt, type DomainModule, type TrustedCallContext } from "../integration/contracts.js";
import { assembleContext, hash } from "./context.js";
import type { AgentHarness, DefinitionSource, HarnessTool, RuntimeEvent, RuntimeStore, TraceEvent } from "./ports.js";
import { loadWorkDefinition, type WorkDefinition } from "./work-definition.js";

export interface RuntimeOptions {
  store: RuntimeStore;
  harness: AgentHarness;
  definitions: DefinitionSource;
  now?: () => Date;
  id?: () => string;
}

export interface CreateWorkInput {
  definitionId: string;
  objective: string;
  input?: unknown;
  domainIds: readonly string[];
}

export class AiricRuntime {
  readonly #works = new Map<string, Work>();
  readonly #actions = new Map<string, Action>();
  readonly #trace: TraceEvent[] = [];
  readonly #domains = new Map<string, DomainModule>();
  readonly #definitions = new Map<string, WorkDefinition>();
  readonly #listeners = new Set<(event: TraceEvent) => void>();
  readonly #controllers = new Map<string, AbortController>();
  readonly #now: () => Date;
  readonly #id: () => string;

  constructor(readonly options: RuntimeOptions) {
    this.#now = options.now ?? (() => new Date());
    this.#id = options.id ?? randomUUID;
  }

  async open(): Promise<void> {
    await this.options.store.open();
    for await (const event of this.options.store.replay()) this.#apply(event);
  }

  async close(): Promise<void> {
    for (const controller of this.#controllers.values()) controller.abort();
    await this.options.store.close();
  }

  registerDomain(module: DomainModule): void {
    const current = this.#domains.get(module.id);
    if (current && current.release === module.release && current.buildId !== module.buildId) {
      throw new Error(`Domain ${module.id}@${module.release} was registered with two build ids`);
    }
    const capabilityIds = new Set<string>();
    for (const capability of module.capabilities) {
      if (capabilityIds.has(capability.id)) throw new Error(`Duplicate capability ${capability.id}`);
      capabilityIds.add(capability.id);
      if (capability.kind === "command" && !module.inspectCommand) {
        throw new Error(`Command capability ${capability.id} requires inspectCommand`);
      }
    }
    this.#domains.set(module.id, module);
  }

  async loadDefinition(definitionId: string): Promise<WorkDefinition> {
    const loaded = await loadWorkDefinition(this.options.definitions, definitionId);
    this.#definitions.set(`${definitionId}@${loaded.revision}`, loaded);
    return loaded;
  }

  listWorks(): readonly Work[] { return [...this.#works.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  getWork(workId: string): Work | undefined { return this.#works.get(workId); }
  getAction(actionId: string): Action | undefined { return this.#actions.get(actionId); }
  getTrace(workId: string): readonly TraceEvent[] { return this.#trace.filter((event) => event.workId === workId); }
  subscribe(listener: (event: TraceEvent) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }

  async createWork(input: CreateWorkInput): Promise<Work> {
    const definition = await this.loadDefinition(input.definitionId);
    const domains = input.domainIds.map((id) => {
      const module = this.#domains.get(id);
      if (!module) throw new Error(`Unknown domain ${id}`);
      return module;
    });
    for (const requirement of definition.manifest.compatibleDomains) {
      const domain = domains.find((candidate) => candidate.id === requirement.id);
      if (!domain) throw new Error(`Definition requires domain ${requirement.id}`);
      if (requirement.release && !releaseMatches(domain.release, requirement.release)) throw new Error(`Domain ${domain.id}@${domain.release} is incompatible with ${requirement.release}`);
    }
    const work = createWork({
      id: this.#id(), objective: input.objective, input: input.input ?? {}, definition: { id: definition.manifest.id, revision: definition.revision },
      domainBindings: domains.map(bindingRef), now: this.#now().toISOString(),
    });
    await this.#persist([{ kind: "work.saved", work }]);
    await this.#traceEvent(work.id, "work.created", "user", { objective: work.objective, definition: work.definition, domainBindings: work.domainBindings });
    return work;
  }

  async sendMessage(workId: string, message: string, actor: TrustedCallContext["actor"]): Promise<{ text: string; result?: unknown }> {
    const work = this.#requireOpenWork(workId);
    await this.#traceEvent(workId, "message.user", actor.id, { text: message });
    const definition = await this.#definitionFor(work);
    const domains = this.#domainsFor(work);
    const sequence = this.#trace.filter((event) => event.workId === workId && event.type === "context.assembled").length + 1;
    const envelope = assembleContext({ work, definition, domains, sequence });
    await this.#traceEvent(workId, "context.assembled", "runtime", {
      envelopeId: envelope.envelopeId, digest: envelope.digest, definition: envelope.workDefinition,
      sources: envelope.provenance, availableCapabilities: envelope.availableCapabilities,
    });
    const tools = this.#toolsFor(work, definition, domains, actor);
    let delivered = false;
    let deliveredDigest: string | undefined;
    let expectedEnvelope = envelope;
    let contextSequence = sequence;
    const gatedTools = tools.map((tool): HarnessTool => ({ ...tool, invoke: async (value, requestId) => { if (!delivered) throw new Error("Context and tool delivery has not been confirmed"); return tool.invoke(value, requestId); } }));
    const controller = new AbortController();
    this.#controllers.set(workId, controller);
    try {
      const result = await this.options.harness.run({
        workId, message, envelope, tools: gatedTools, signal: controller.signal,
        refreshContext: async () => {
          contextSequence += 1;
          const refreshedWork = this.#requireWork(workId);
          const refreshed = assembleContext({ work: refreshedWork, definition: await this.#definitionFor(refreshedWork), domains: this.#domainsFor(refreshedWork), sequence: contextSequence });
          await this.#traceEvent(workId, "context.assembled", "runtime", { envelopeId: refreshed.envelopeId, digest: refreshed.digest, definition: refreshed.workDefinition, sources: refreshed.provenance, availableCapabilities: refreshed.availableCapabilities, reason: "before-model-call" });
          expectedEnvelope = refreshed;
          return refreshed;
        },
        onDelivered: async (record) => {
          const missing = envelope.availableCapabilities.filter((id) => !record.registeredTools.includes(toolName(id)));
          if (record.envelopeDigest !== expectedEnvelope.digest || missing.length) throw new Error(`Harness delivery mismatch${missing.length ? `; missing tools: ${missing.join(", ")}` : ""}`);
          await this.#traceEvent(workId, "context.delivered", "harness", record);
          delivered = true;
          deliveredDigest = record.envelopeDigest;
        },
        onEvent: async (event) => this.#traceEvent(workId, `harness.${event.type}`, "harness", { ...asObject(event.payload), providerEventId: event.providerEventId }),
      });
      if (!delivered || deliveredDigest !== expectedEnvelope.digest) throw new Error("Harness returned without confirming the latest ContextEnvelope delivery");
      await this.#traceEvent(workId, "message.agent", "agent", { text: result.text, result: result.result });
      return result;
    } finally {
      this.#controllers.delete(workId);
    }
  }

  async interrupt(workId: string): Promise<void> {
    this.#controllers.get(workId)?.abort();
    await this.options.harness.interrupt?.(workId);
    await this.#traceEvent(workId, "harness.interrupted", "user", {});
  }

  async selectContent(workId: string, documentId: string, reason: string): Promise<Work> {
    const work = this.#requireOpenWork(workId);
    const definition = await this.#definitionFor(work);
    const document = definition.documents.get(documentId);
    if (!document) throw new Error(`Unknown Work Definition document ${documentId}`);
    const selected = new Set(work.selectedContent);
    const addWithDependencies = (id: string) => {
      if (selected.has(id)) return;
      selected.add(id);
      for (const dependency of definition.documents.get(id)?.requires ?? []) addWithDependencies(dependency);
    };
    addWithDependencies(documentId);
    const selectedContent = [...selected];
    const revised = reviseWork(work, { selectedContent }, this.#now().toISOString());
    await this.#persist([{ kind: "work.saved", work: revised }]);
    await this.#traceEvent(workId, "context.retrieved", "agent", { source: "work-definition", documentId, path: document.path, digest: document.digest, reason });
    return revised;
  }

  async completeWork(workId: string, result: unknown): Promise<Work> {
    const work = this.#requireOpenWork(workId);
    const definition = await this.#definitionFor(work);
    const toolResults = new Set(this.getTrace(workId).filter((event) => event.type === "tool.result").map((event) => String((event.payload as { capabilityId?: string }).capabilityId)));
    const committedCommands = new Set([...this.#actions.values()].filter((action) => action.workId === workId && action.status === "committed").map((action) => action.capabilityId));
    const capabilities = this.#domainsFor(work).flatMap((domain) => domain.capabilities);
    const missing = definition.manifest.completion.requiredCapabilities.filter((id) => {
      const capability = capabilities.find((candidate) => candidate.id === id);
      return capability?.kind === "command" ? !committedCommands.has(id) : !toolResults.has(id);
    });
    if (missing.length) throw new Error(`Work cannot complete before capabilities: ${missing.join(", ")}`);
    const completed = reviseWork(work, { status: "completed", result }, this.#now().toISOString());
    await this.#persist([{ kind: "work.saved", work: completed }]);
    await this.#traceEvent(workId, "work.completed", "agent", { result });
    return completed;
  }

  async recordReflectionCandidate(workId: string, candidate: {
    targetKind: "operating-model" | "domain" | "associated";
    targetPath: string;
    baseRevision: string;
    diff: string;
    rationale: string;
    evidenceEventIds: readonly string[];
    validation?: unknown;
  }): Promise<{ digest: string; size: number }> {
    const work = this.#requireOpenWork(workId);
    const definition = await this.#definitionFor(work);
    if (!definition.manifest.documents.some((document) => document.role === "reflection")) throw new Error("Candidate creation requires a Reflection Work Definition");
    const object = await this.options.store.putObject(new TextEncoder().encode(candidate.diff));
    await this.#traceEvent(workId, "reflection.candidate", "agent", { ...candidate, diff: undefined, object });
    return object;
  }

  async recordReflectionOutcome(workId: string, outcome: { candidateDigest: string; decision: "adopted" | "rejected"; reviewer: string; publishedRef?: { kind: "work-definition" | "domain-release"; id: string; revision: string }; validation?: unknown }): Promise<void> {
    this.#requireWork(workId);
    const candidate = this.getTrace(workId).find((event) => event.type === "reflection.candidate" && (event.payload as { object?: { digest?: string } }).object?.digest === outcome.candidateDigest);
    if (!candidate) throw new Error("Reflection outcome must reference a candidate from the same Work");
    if (outcome.decision === "adopted" && !outcome.publishedRef) throw new Error("An adopted candidate requires the actually published definition or domain release");
    await this.#traceEvent(workId, `reflection.${outcome.decision}`, outcome.reviewer, outcome);
  }

  async attachEvidence(workId: string, input: { name: string; mediaType: string; content: Uint8Array }): Promise<{ digest: string; size: number }> {
    this.#requireOpenWork(workId);
    const object = await this.options.store.putObject(input.content);
    await this.#traceEvent(workId, "context.external", "user", { name: input.name, mediaType: input.mediaType, object });
    return object;
  }

  async reconcileAction(actionId: string, actor: TrustedCallContext["actor"]): Promise<Action> {
    const action = this.#actions.get(actionId);
    if (!action) throw new Error(`Unknown Action ${actionId}`);
    if (!["prepared", "pending", "unknown"].includes(action.status)) return action;
    const module = this.#domains.get(action.domainId);
    if (!module?.inspectCommand) return action;
    const inspection = await module.inspectCommand(this.#callContext(this.#requireWork(action.workId), module, actor, action), action.commandId);
    if (!inspection) return action;
    const status = inspection.status === "committed" ? "committed" : inspection.status === "rejected" ? "rejected" : "pending";
    const settled = settleAction(action, status, this.#now().toISOString(), inspection.status === "rejected" ? { ...(inspection.error ? { error: inspection.error } : {}) } : { receipt: inspection });
    await this.#saveAction(settled, "action.reconciled", { inspection });
    return settled;
  }

  async rebindWork(workId: string): Promise<Work> {
    const work = this.#requireOpenWork(workId);
    const latestDefinition = await this.loadDefinition(work.definition.id);
    const modules = work.domainBindings.map((binding) => this.#domains.get(binding.id) ?? fail(`Unknown domain ${binding.id}`));
    for (const requirement of latestDefinition.manifest.compatibleDomains) {
      const module = modules.find((candidate) => candidate.id === requirement.id);
      if (!module || (requirement.release && !releaseMatches(module.release, requirement.release))) throw new Error(`Current domain ${requirement.id} is incompatible with the latest Work Definition`);
    }
    const domainBindings = modules.map(bindingRef);
    const revised = reviseWork(work, { domainBindings }, this.#now().toISOString());
    const rebound = { ...revised, definition: { id: latestDefinition.manifest.id, revision: latestDefinition.revision } };
    await this.#persist([{ kind: "work.saved", work: rebound }]);
    await this.#traceEvent(workId, "context.binding-changed", "runtime", { from: { definition: work.definition, domains: work.domainBindings }, to: { definition: rebound.definition, domains: rebound.domainBindings } });
    return rebound;
  }

  #toolsFor(work: Work, definition: WorkDefinition, domains: readonly DomainModule[], actor: TrustedCallContext["actor"]): HarnessTool[] {
    const capabilityTools = domains.flatMap((module) => module.capabilities.map((capability): HarnessTool => ({
      name: toolName(capability.id), description: capability.description, inputSchema: capability.inputSchema,
      invoke: async (input, requestId) => this.#invokeCapability(work.id, module, capability.id, input, requestId, actor),
    })));
    return [
      ...capabilityTools,
      { name: "airic_read_work_document", description: "Load an on-demand Work Definition document for the next reasoning step.", inputSchema: { type: "object", properties: { id: { type: "string" }, reason: { type: "string" } }, required: ["id", "reason"] }, invoke: async (value) => { const input = value as { id: string; reason: string }; const revised = await this.selectContent(work.id, input.id, input.reason); const doc = definition.documents.get(input.id)!; return { id: doc.id, content: doc.content, digest: doc.digest, workRevision: revised.revision }; } },
      { name: "airic_read_domain_source", description: "Read reviewed domain source tied to the active release.", inputSchema: { type: "object", properties: { domainId: { type: "string" }, path: { type: "string" }, symbol: { type: "string" }, reason: { type: "string" } }, required: ["domainId", "path", "reason"] }, invoke: async (value) => { const input = value as { domainId: string; path: string; symbol?: string; reason: string }; const module = domains.find((candidate) => candidate.id === input.domainId); if (!module?.readSource) throw new Error(`Domain source is unavailable for ${input.domainId}`); const result = await module.readSource({ path: input.path, ...(input.symbol ? { symbol: input.symbol } : {}) }); await this.#traceEvent(work.id, "context.retrieved", "agent", { source: "domain", domainId: module.id, release: module.release, locator: result.locator, digest: hash(result.content), reason: input.reason }); return result; } },
      { name: "airic_read_work_trace", description: "Read canonical trace for this Work, or the source Work named by a Reflection Work.", inputSchema: { type: "object", properties: { workId: { type: "string" }, reason: { type: "string" } }, required: ["reason"] }, invoke: async (value) => { const input = value as { workId?: string; reason: string }; const sourceWorkId = work.definition.id === "reflection" ? String(input.workId ?? (work.input as { sourceWorkId?: string }).sourceWorkId ?? work.id) : work.id; const events = this.getTrace(sourceWorkId); if (!events.length) throw new Error(`No readable trace for Work ${sourceWorkId}`); await this.#traceEvent(work.id, "context.retrieved", "agent", { source: "trace", sourceWorkId, eventCount: events.length, reason: input.reason }); return events; } },
      { name: "airic_record_reflection_candidate", description: "Store a reviewable candidate diff linked to trace evidence.", inputSchema: { type: "object", properties: { targetKind: { enum: ["operating-model", "domain", "associated"] }, targetPath: { type: "string" }, baseRevision: { type: "string" }, diff: { type: "string" }, rationale: { type: "string" }, evidenceEventIds: { type: "array", items: { type: "string" } } }, required: ["targetKind", "targetPath", "baseRevision", "diff", "rationale", "evidenceEventIds"] }, invoke: async (value) => { if (work.definition.id !== "reflection") throw new Error("Reflection candidates can only be produced by a Reflection Work"); return this.recordReflectionCandidate(work.id, value as Parameters<AiricRuntime["recordReflectionCandidate"]>[1]); } },
      { name: "airic_complete_work", description: "Complete the Work with a structured result after required domain effects are confirmed.", inputSchema: { type: "object", properties: { result: {} }, required: ["result"] }, invoke: async (value) => this.completeWork(work.id, (value as { result: unknown }).result) },
    ];
  }

  async #invokeCapability(workId: string, module: DomainModule, capabilityId: string, input: unknown, requestId: string, actor: TrustedCallContext["actor"]): Promise<unknown> {
    const work = this.#requireOpenWork(workId);
    const binding = work.domainBindings.find((candidate) => candidate.id === module.id);
    if (!binding || binding.release !== module.release || binding.buildId !== module.buildId) throw new Error(`BindingChanged: ${module.id}`);
    const capability = module.capabilities.find((candidate) => candidate.id === capabilityId);
    if (!capability) throw new Error(`Unknown capability ${capabilityId}`);
    await this.#traceEvent(workId, "tool.called", "agent", { capabilityId, kind: capability.kind, requestId, input });
    if (capability.kind !== "command") {
      const result = await capability.invoke(this.#callContext(work, module, actor), input);
      await this.#traceEvent(workId, "tool.result", "domain", { capabilityId, requestId, result });
      return result;
    }
    const actionId = hash(`${workId}:${requestId}`).slice(0, 32);
    const commandId = `airic:${workId}:${requestId}`;
    const payloadDigest = hash(JSON.stringify(input));
    const prior = this.#actions.get(actionId);
    if (prior) {
      if (prior.payloadDigest !== payloadDigest || prior.capabilityId !== capabilityId) throw new Error("A stable request id cannot be reused for a different business intent");
      const reconciled = await this.reconcileAction(actionId, actor);
      if (reconciled.status === "committed") return reconciled.receipt;
      if (reconciled.status === "rejected") throw new DomainInvocationError(reconciled.error?.message ?? "Domain rejected command", "not-applied", reconciled.error?.code, reconciled.error?.details);
      throw new DomainInvocationError("Command outcome is not yet known", "unknown", "CommandUnknown", { actionId });
    }
    const action = prepareAction({ id: actionId, workId, requestId, commandId, domainId: module.id, domainRelease: module.release, capabilityId, payloadDigest, now: this.#now().toISOString() });
    await this.#saveAction(action, "action.prepared", { input });
    try {
      const raw = await capability.invoke(this.#callContext(work, module, actor, action), input);
      const receipt = raw as CommandReceipt;
      if (!receipt || receipt.commandId !== commandId || !["committed", "pending", "rejected"].includes(receipt.status)) throw new DomainInvocationError("Domain returned an invalid command receipt", "unknown", "InvalidReceipt", raw);
      const status = receipt.status === "committed" ? "committed" : receipt.status === "rejected" ? "rejected" : "pending";
      const settled = settleAction(action, status, this.#now().toISOString(), status === "rejected" ? { ...(receipt.error ? { error: receipt.error } : {}) } : { receipt });
      await this.#saveAction(settled, `action.${status}`, { receipt });
      await this.#traceEvent(workId, "tool.result", "domain", { capabilityId, requestId, actionId, receipt });
      if (status === "rejected") throw new DomainInvocationError(receipt.error?.message ?? "Domain rejected command", "not-applied", receipt.error?.code, receipt.error?.details);
      return receipt;
    } catch (error) {
      if (error instanceof DomainInvocationError && error.outcome === "not-applied") {
        if (this.#actions.get(actionId)?.status !== "rejected") await this.#saveAction(settleAction(action, "failed", this.#now().toISOString(), { error: { code: error.code, message: error.message, details: error.details } }), "action.failed", {});
        throw error;
      }
      const invocation = error instanceof DomainInvocationError ? error : new DomainInvocationError(error instanceof Error ? error.message : String(error), "unknown");
      await this.#saveAction(settleAction(action, "unknown", this.#now().toISOString(), { error: { code: invocation.code, message: invocation.message, details: invocation.details } }), "action.unknown", {});
      throw invocation;
    }
  }

  #callContext(work: Work, module: DomainModule, actor: TrustedCallContext["actor"], action?: Action): TrustedCallContext {
    return { actor, workId: work.id, expectedDomainRelease: module.release, ...(action ? { actionId: action.id, commandId: action.commandId } : {}) };
  }
  #domainsFor(work: Work): DomainModule[] { return work.domainBindings.map((binding) => { const module = this.#domains.get(binding.id); if (!module) throw new Error(`Domain ${binding.id} is not registered`); return module; }); }
  async #definitionFor(work: Work): Promise<WorkDefinition> { return this.#definitions.get(`${work.definition.id}@${work.definition.revision}`) ?? loadWorkDefinition(this.options.definitions, work.definition.id, work.definition.revision).then((definition) => { if (definition.revision !== work.definition.revision) throw new Error(`Pinned Work Definition ${work.definition.id}@${work.definition.revision} is unavailable`); this.#definitions.set(`${definition.manifest.id}@${definition.revision}`, definition); return definition; }); }
  #requireWork(id: string): Work { return this.#works.get(id) ?? fail(`Unknown Work ${id}`); }
  #requireOpenWork(id: string): Work { const work = this.#requireWork(id); if (work.status !== "open") throw new Error(`Work ${id} is ${work.status}`); return work; }
  async #saveAction(action: Action, type: TraceEvent["type"], payload: unknown): Promise<void> { await this.#persist([{ kind: "action.saved", action }]); await this.#traceEvent(action.workId, type, "runtime", payload, action.id); }
  async #traceEvent(workId: string, type: TraceEvent["type"], actor: string, payload: unknown, actionId?: string): Promise<void> {
    const event: TraceEvent = { schemaVersion: 1, eventId: this.#id(), workId, type, timestamp: this.#now().toISOString(), actor, payload, ...(actionId ? { actionId } : {}) };
    await this.#persist([{ kind: "trace.appended", event }]);
  }
  async #persist(events: readonly RuntimeEvent[]): Promise<void> { await this.options.store.append(events); for (const event of events) this.#apply(event); }
  #apply(event: RuntimeEvent): void {
    if (event.kind === "work.saved") this.#works.set(event.work.id, event.work);
    else if (event.kind === "action.saved") this.#actions.set(event.action.id, event.action);
    else { this.#trace.push(event.event); for (const listener of this.#listeners) listener(event.event); }
  }
}

export function toolName(capabilityId: string): string { return `domain_${capabilityId.replace(/[^a-zA-Z0-9_-]/g, "_")}`; }
function asObject(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : { value }; }
function fail(message: string): never { throw new Error(message); }
function releaseMatches(actual: string, requirement: string): boolean { return requirement.endsWith(".*") ? actual.startsWith(requirement.slice(0, -1)) : actual === requirement; }
