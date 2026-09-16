import { randomUUID } from "node:crypto";
import { prepareAction, settleAction, type Action } from "../domain/action.js";
import { createWork, reviseWork, type Work } from "../domain/work.js";
import { bindingRef, DomainInvocationError, type CommandReceipt, type DomainProvider, type TrustedCallContext } from "../integration/contracts.js";
import { assembleContext, hash, type TurnContextRef } from "./context.js";
import type { AgentHarness, HarnessTool, LiveWorkEvent, RuntimeEvent, RuntimeStore, TraceEvent, WorkEvidenceExtraction } from "./ports.js";
import type { OperatingModelAuthoringPort, OperatingModelChangeSet, OperatingModelId, OperatingModelRevisionRef, OperatingModelRuntimePort } from "./operating-model.js";
import { loadWorkDefinition, type WorkDefinition } from "./work-definition.js";
import type { ModuleRegistry } from "./module.js";

export interface RuntimeOptions {
  store: RuntimeStore;
  harness: AgentHarness;
  modules: ModuleRegistry;
  now?: () => Date;
  id?: () => string;
  authorizeWork?: (actor: TrustedCallContext["actor"], work: Work, action: "prompt" | "capability" | "read-trace") => Promise<boolean> | boolean;
  onTraceRead?: (actor: TrustedCallContext["actor"], work: Work, reason: string) => Promise<void>;
  extractEvidence?: (input: { name: string; mediaType: string; content: Uint8Array }) => Promise<WorkEvidenceExtraction>;
  operatingModels: OperatingModelRuntimePort;
  operatingModelAuthoring?: OperatingModelAuthoringPort;
  /** Host-owned allowlist. Work Definition content cannot grant authoring tools. */
  operatingModelAuthoringWorkTypes?: { reflection: readonly Work["workType"][]; smith: readonly Work["workType"][] };
}

export interface CreateWorkInput {
  moduleId: string;
  workTypeId: string;
  objective: string;
  input?: unknown;
  sourceWorks?: readonly { workId: string }[];
}

export class AiricRuntime {
  readonly #works = new Map<string, Work>();
  readonly #actions = new Map<string, Action>();
  readonly #trace: TraceEvent[] = [];
  readonly #listeners = new Set<(event: TraceEvent) => void>();
  readonly #liveListeners = new Set<(event: LiveWorkEvent) => void>();
  readonly #controllers = new Map<string, AbortController>();
  readonly #activeTurns = new Set<string>();
  readonly #turnRevisions = new Map<string, OperatingModelRevisionRef>();
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

  async loadDefinition(moduleId: string, workTypeId: string): Promise<WorkDefinition> {
    this.options.modules.resolve({ moduleId, workTypeId });
    const target = { moduleId, workTypeId };
    return loadWorkDefinition(await this.options.operatingModels.readRevision(target, await this.options.operatingModels.resolveActive(target)));
  }

  listWorks(): readonly Work[] { return [...this.#works.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  getWork(workId: string): Work | undefined { return this.#works.get(workId); }
  getAction(actionId: string): Action | undefined { return this.#actions.get(actionId); }
  getTrace(workId: string): readonly TraceEvent[] { return this.#trace.filter((event) => event.workId === workId); }
  subscribe(listener: (event: TraceEvent) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  subscribeLive(listener: (event: LiveWorkEvent) => void): () => void { this.#liveListeners.add(listener); return () => this.#liveListeners.delete(listener); }

  async createWork(input: CreateWorkInput, actor: TrustedCallContext["actor"]): Promise<Work> {
    if (!actor?.id) throw new Error("A trusted actor is required to create Work");
    const resolved = this.options.modules.resolve({ moduleId: input.moduleId, workTypeId: input.workTypeId });
    const definition = await this.loadDefinition(input.moduleId, input.workTypeId);
    const domains = resolved.domains;
    const availableCapabilities = new Set(domains.flatMap((domain) => domain.capabilities.map((capability) => capability.id)));
    const unavailableCapabilities = definition.manifest.capabilities.allowed.filter((id) => !availableCapabilities.has(id));
    if (unavailableCapabilities.length) throw new Error(`Definition allows unavailable capabilities: ${unavailableCapabilities.join(", ")}`);
    const sourceWorks = input.sourceWorks ?? [];
    if (sourceWorks.length && !this.#isReflectionRef(resolved.ref)) throw new Error("Only a trusted Reflection WorkType may bind source Works");
    const seenSources = new Set<string>();
    for (const source of sourceWorks) {
      if (!source.workId || seenSources.has(source.workId)) throw new Error("Duplicate source Work"); seenSources.add(source.workId);
      const sourceWork = this.#requireWork(source.workId); await this.#authorize(actor, sourceWork, "read-trace");
    }
    const work = createWork({
      id: this.#id(), createdBy: actor.id, objective: input.objective, input: input.input ?? {}, workType: resolved.ref,
      domainBindings: domains.map(bindingRef), sourceWorks, now: this.#now().toISOString(),
    });
    await this.#persist([{ kind: "work.saved", work }]);
    await this.#traceEvent(work.id, "work.created", "user", { objective: work.objective, workType: work.workType, domainBindings: work.domainBindings });
    return work;
  }

  async attachSourceWork(workId: string, sourceWorkId: string, actor: TrustedCallContext["actor"]): Promise<Work> {
    const work = this.#requireOpenWork(workId); if (!this.#isReflection(work)) throw new Error("Only a trusted Reflection Work may bind source Works");
    if (work.id === sourceWorkId || work.sourceWorks.some((source) => source.workId === sourceWorkId)) throw new Error("Duplicate or self source Work");
    const source = this.#requireWork(sourceWorkId); await this.#authorize(actor, work, "prompt"); await this.#authorize(actor, source, "read-trace");
    const revised = reviseWork(work, { sourceWorks: [...work.sourceWorks, { workId: sourceWorkId }] }, this.#now().toISOString());
    await this.#persist([{ kind: "work.saved", work: revised }]); await this.#traceEvent(workId, "context.source-work-attached", actor.id, { sourceWorkId }); return revised;
  }

  async sendMessage(workId: string, message: string, actor: TrustedCallContext["actor"], turnContextRefs?: readonly TurnContextRef[]): Promise<{ text: string; result?: unknown }> {
    const work = this.#requireOpenWork(workId);
    await this.#authorize(actor, work, "prompt");
    if (this.#activeTurns.has(workId)) throw new Error(`WorkBusy: ${workId}`);
    this.#activeTurns.add(workId);
    try { return await this.#runTurn(work, message, actor, turnContextRefs); }
    finally { this.#activeTurns.delete(workId); }
  }

  async #runTurn(work: Work, message: string, actor: TrustedCallContext["actor"], turnContextRefs?: readonly TurnContextRef[]): Promise<{ text: string; result?: unknown }> {
    const workId = work.id;
    this.#turnRevisions.set(workId, await this.options.operatingModels.resolveActive(work.workType));
    await this.#traceEvent(workId, "message.user", actor.id, { text: message, ...(turnContextRefs?.length ? { turnContextRefs } : {}) });
    const domains = this.#domainsFor(work);
    const sequence = this.#trace.filter((event) => event.workId === workId && event.type === "context.assembled").length + 1;
    const initial = await this.#assembleAndTrace(work, domains, sequence, undefined, turnContextRefs);
    const definition = initial.definition;
    const envelope = initial.envelope;
    const tools = this.#toolsFor(work, definition, domains, actor);
    let delivered = false;
    let deliveredDigest: string | undefined;
    let expectedEnvelope = envelope;
    let contextSequence = sequence;
    const gatedTools = tools.map((tool): HarnessTool => ({ ...tool, invoke: async (value, requestId) => { if (!delivered) throw new Error("Context and tool delivery has not been confirmed"); await this.#authorize(actor, this.#requireOpenWork(workId), "capability"); return tool.invoke(value, requestId); } }));
    const controller = new AbortController();
    this.#controllers.set(workId, controller);
    try {
      const result = await this.options.harness.run({
        workId, workInput: work.input, message, envelope, tools: gatedTools, signal: controller.signal,
        refreshContext: async () => {
          await this.#authorize(actor, this.#requireWork(workId), "prompt");
          contextSequence += 1;
          const refreshedWork = this.#requireWork(workId);
          const refreshed = (await this.#assembleAndTrace(refreshedWork, this.#domainsFor(refreshedWork), contextSequence, "before-model-call", turnContextRefs)).envelope;
          expectedEnvelope = refreshed;
          return refreshed;
        },
        onDelivered: async (record) => {
          const missing = expectedEnvelope.availableCapabilities.filter((id) => !record.registeredTools.includes(toolName(id)));
          if (record.envelopeDigest !== expectedEnvelope.digest || missing.length) throw new Error(`Harness delivery mismatch${missing.length ? `; missing tools: ${missing.join(", ")}` : ""}`);
          await this.#traceEvent(workId, "context.delivered", "harness", record);
          delivered = true;
          deliveredDigest = record.envelopeDigest;
        },
        onEvent: async (event) => {
          if (event.type === "message" && typeof (event.payload as { delta?: unknown })?.delta === "string") {
            for (const listener of this.#liveListeners) listener({ workId, type: "text-delta", text: (event.payload as { delta: string }).delta });
            return;
          }
          await this.#traceEvent(workId, event.type === "tool" ? "tool.execution" : `harness.${event.type}`, "harness", { ...asObject(event.payload), providerEventId: event.providerEventId });
        },
      });
      if (!delivered || deliveredDigest !== expectedEnvelope.digest) throw new Error("Harness returned without confirming the latest ContextEnvelope delivery");
      await this.#traceEvent(workId, "message.agent", "agent", { text: result.text, result: result.result });
      return result;
    } finally {
      this.#controllers.delete(workId);
      this.#turnRevisions.delete(workId);
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
    const trace = [...this.getTrace(workId)];
    const contextIndex = trace.findLastIndex((event) => event.type === "context.assembled" && (event.payload as { workType?: { operatingDigest?: string } }).workType?.operatingDigest !== definition.digest);
    const currentEvidence = trace.slice(contextIndex + 1);
    const toolResults = new Set(currentEvidence.filter((event) => event.type === "tool.result").map((event) => String((event.payload as { capabilityId?: string }).capabilityId)));
    const committedCommands = new Set([...this.#actions.values()].filter((action) => action.workId === workId && action.status === "committed").map((action) => action.capabilityId));
    const allowed = new Set(definition.manifest.capabilities.allowed);
    const capabilities = this.#domainsFor(work).flatMap((domain) => domain.capabilities).filter((capability) => allowed.has(capability.id));
    const missing = definition.manifest.completion.requiredCapabilities.filter((id) => {
      const capability = capabilities.find((candidate) => candidate.id === id);
      return capability?.kind === "command" ? !committedCommands.has(id) : !toolResults.has(id);
    });
    if (missing.length) throw new Error(`Work cannot complete before capabilities: ${missing.join(", ")}`);
    const successfulHarnessEvents = currentEvidence
      .filter((event) => event.type === "tool.execution")
      .filter((event) => {
        const payload = event.payload as { phase?: string; isError?: boolean; name?: string; result?: { changes?: unknown[]; check?: { status?: string } } };
        if (payload.phase !== "end" || payload.isError !== false) return false;
        if (payload.name === "workspace_changes") return Array.isArray(payload.result?.changes) && payload.result.changes.length > 0;
        if (payload.name?.startsWith("workspace_check_")) return payload.result?.check?.status === "passed";
        return true;
      });
    const workspaceRequired = definition.manifest.completion.requiredTools.some((name) => name.startsWith("workspace_"));
    const latestChangeSet = [...successfulHarnessEvents].reverse().find((event) => (event.payload as { name?: string }).name?.startsWith("workspace_"));
    const evidencedChangeSet = (latestChangeSet?.payload as { result?: { changeSetDigest?: string } } | undefined)?.result?.changeSetDigest;
    const currentChangeSet = workspaceRequired && this.options.harness.currentWorkspaceChangeSet
      ? await this.options.harness.currentWorkspaceChangeSet(workId) : evidencedChangeSet;
    if (workspaceRequired && evidencedChangeSet && (!currentChangeSet || currentChangeSet !== evidencedChangeSet)) {
      throw new Error("Work cannot complete with stale workspace validation evidence");
    }
    const successfulHarnessTools = new Set(successfulHarnessEvents
      .filter((event) => !(event.payload as { name?: string }).name?.startsWith("workspace_") || (event.payload as { result?: { changeSetDigest?: string } }).result?.changeSetDigest === currentChangeSet)
      .map((event) => String((event.payload as { name?: string }).name)));
    const missingTools = definition.manifest.completion.requiredTools.filter((name) => !successfulHarnessTools.has(name));
    if (missingTools.length) throw new Error(`Work cannot complete before tools: ${missingTools.join(", ")}`);
    const completed = reviseWork(work, { status: "completed", result }, this.#now().toISOString());
    await this.#persist([{ kind: "work.saved", work: completed }]);
    await this.#traceEvent(workId, "work.completed", "agent", { result });
    return completed;
  }

  async recordOperatingModelCandidate(workId: string, candidate: {
    target: OperatingModelId;
    baseRevision: OperatingModelRevisionRef;
    changeSet: OperatingModelChangeSet;
    rationale: string;
    evidenceRefs: readonly { workId: string; eventId: string }[];
    supersedesProposalId?: string;
  }): Promise<{ proposalId: string; candidateDigest: string }> {
    const work = this.#requireOpenWork(workId);
    const kind = this.#isReflection(work) ? "reflection" : this.#isSmith(work) ? "smith" : undefined;
    if (!kind) throw new Error("Candidate creation requires a trusted Reflection or Operating Model Smith Work");
    const bound = (work.input as { operatingModelTarget?: { moduleId?: string; workTypeId?: string; baseRevision?: OperatingModelRevisionRef } }).operatingModelTarget;
    if (kind === "smith" && (!bound || bound.moduleId !== candidate.target.moduleId || bound.workTypeId !== candidate.target.workTypeId || !bound.baseRevision || bound.baseRevision.contentDigest !== candidate.baseRevision.contentDigest || bound.baseRevision.revisionId !== candidate.baseRevision.revisionId)) throw new Error("OperatingModelSmithTargetMismatch");
    if (kind === "reflection") {
      const allowed = new Set(work.sourceWorks.map((source) => source.workId));
      for (const evidence of candidate.evidenceRefs) {
        if (!allowed.has(evidence.workId) || !this.getTrace(evidence.workId).some((event) => event.eventId === evidence.eventId)) throw new Error("ReflectionEvidenceMismatch");
      }
    }
    const port = this.options.operatingModelAuthoring; if (!port) throw new Error("OperatingModelAuthoringNotConfigured");
    const authoringRevision = this.#turnRevisions.get(workId) ?? await this.options.operatingModels.resolveActive(work.workType);
    const trajectoryRevisions = work.sourceWorks.map((source) => ({ workId: source.workId, revisions: this.#trajectoryRevisions(source.workId) }));
    const result = await port.propose({ operationId: `${kind}:${workId}:${hash(JSON.stringify(candidate.changeSet))}`, target: candidate.target, baseRevision: candidate.baseRevision, changeSet: candidate.changeSet, rationale: candidate.rationale, evidenceRefs: candidate.evidenceRefs, provenance: { authoringWorkId: workId, authoringRevision, trajectoryRevisions }, proposer: { kind, id: "agent" }, ...(candidate.supersedesProposalId ? { supersedesProposalId: candidate.supersedesProposalId } : {}) });
    if (result.status !== "committed" || !("proposalId" in result.result) || !("candidateDigest" in result.result)) throw new Error(result.status === "rejected" ? result.error.message : "Operating Model proposal outcome is unknown");
    await this.#traceEvent(workId, "reflection.proposed", "agent", { proposalId: result.result.proposalId, candidateDigest: result.result.candidateDigest, evidenceRefs: candidate.evidenceRefs, authoringRevision, trajectoryRevisions });
    return { proposalId: result.result.proposalId, candidateDigest: result.result.candidateDigest };
  }

  /** Compatibility shim for older hosts; new callers must use a structured change set. */
  async recordReflectionCandidate(workId: string, raw: { target?: OperatingModelId; targetPath?: string; diff?: string; rationale?: string; evidenceEventIds?: readonly string[] }): Promise<{ proposalId: string; candidateDigest: string }> {
    const target = raw.target; if (!target || !raw.targetPath || raw.diff === undefined) throw new Error("Reflection candidate patches are no longer supported; submit an OperatingModelChangeSet");
    const baseRevision = await this.options.operatingModels.resolveActive(target); const base = await this.options.operatingModels.readRevision(target, baseRevision); const current = base.files.find((file) => file.path === raw.targetPath)?.content;
    if (current === undefined) throw new Error("Reflection candidate path is not present in the active package");
    return this.recordOperatingModelCandidate(workId, { target, baseRevision, changeSet: { upsert: [{ path: raw.targetPath, content: `${current}\n${raw.diff}` }], delete: [] }, rationale: raw.rationale ?? "", evidenceRefs: (raw.evidenceEventIds ?? []).map((eventId) => ({ workId, eventId })) });
  }

  async attachEvidence(workId: string, input: { name: string; mediaType: string; content: Uint8Array }): Promise<{ digest: string; size: number; extraction?: { digest: string; blocks: number; warnings: readonly string[] } }> {
    this.#requireOpenWork(workId);
    const extracted = await this.options.extractEvidence?.(input);
    if (extracted && (extracted.blocks.length > 1000 || extracted.blocks.some((block) => !block.locator || block.text.length > 12000) || JSON.stringify(extracted).length > 500000)) throw new Error("Extracted evidence exceeds Work limits");
    const object = await this.options.store.putObject(input.content);
    const projection = extracted ? await this.options.store.putObject(new TextEncoder().encode(JSON.stringify(extracted))) : undefined;
    const extraction = projection ? { digest: projection.digest, blocks: extracted!.blocks.length, warnings: extracted!.warnings } : undefined;
    await this.#traceEvent(workId, "context.external", "user", { name: input.name, mediaType: input.mediaType, object, ...(extraction ? { extraction } : {}) });
    return { ...object, ...(extraction ? { extraction } : {}) };
  }

  async reconcileAction(actionId: string, actor: TrustedCallContext["actor"]): Promise<Action> {
    const action = this.#actions.get(actionId);
    if (!action) throw new Error(`Unknown Action ${actionId}`);
    if (!["prepared", "pending", "unknown"].includes(action.status)) return action;
    const module = this.options.modules.domainById(action.domainId);
    if (!module?.inspectCommand) return action;
    const work = this.#requireWork(action.workId);
    const definition = await this.#definitionFor(work);
    const inspection = await module.inspectCommand(this.#callContext(work, module, definition, actor, action), action.commandId);
    if (!inspection) return action;
    const status = inspection.status === "committed" ? "committed" : inspection.status === "rejected" ? "rejected" : "pending";
    const settled = settleAction(action, status, this.#now().toISOString(), inspection.status === "rejected" ? { ...(inspection.error ? { error: inspection.error } : {}) } : { receipt: inspection });
    await this.#saveAction(settled, "action.reconciled", { inspection });
    return settled;
  }

  #toolsFor(work: Work, definition: WorkDefinition, domains: readonly DomainProvider[], actor: TrustedCallContext["actor"]): HarnessTool[] {
    const allowed = new Set(definition.manifest.capabilities.allowed);
    const capabilityTools = domains.flatMap((module) => module.capabilities.filter((capability) => allowed.has(capability.id)).map((capability): HarnessTool => ({
      name: toolName(capability.id), description: capability.description, inputSchema: capability.inputSchema,
      invoke: async (input, requestId) => this.#invokeCapability(work.id, module, capability.id, input, requestId, actor),
    })));
    return [
      ...capabilityTools,
      ...(this.options.extractEvidence ? [
        { name: "airic_list_work_evidence", description: "List Work documents, or list up to 50 block locators of one document (digest, offset). No document text is returned.", inputSchema: { type: "object", properties: { digest: { type: "string" }, offset: { type: "integer", minimum: 0 } }, additionalProperties: false }, invoke: async (value: unknown) => {
          const input = value as { digest?: string; offset?: number };
          const events = this.getTrace(work.id).filter((event) => event.type === "context.external");
          if (!input.digest) return events.map((event) => { const item = event.payload as { name: string; mediaType: string; object: { digest: string; size: number }; extraction?: { blocks: number; warnings: readonly string[] } }; return { name: item.name, mediaType: item.mediaType, digest: item.object.digest, size: item.object.size, blocks: item.extraction?.blocks ?? 0, warnings: item.extraction?.warnings ?? ["No readable text projection"] }; });
          const event = events.find((item) => (item.payload as { object?: { digest?: string } }).object?.digest === input.digest);
          const extraction = (event?.payload as { extraction?: { digest: string } } | undefined)?.extraction;
          if (!extraction) throw new Error("No readable extraction for this Work evidence");
          const projection = JSON.parse(new TextDecoder().decode(await this.options.store.getObject(extraction.digest))) as WorkEvidenceExtraction;
          const offset = Number.isSafeInteger(input.offset ?? 0) && (input.offset ?? 0) >= 0 ? input.offset ?? 0 : 0;
          return { digest: input.digest, total: projection.blocks.length, offset, locators: projection.blocks.slice(offset, offset + 50).map((block) => block.locator), warnings: projection.warnings };
        } },
        { name: "airic_read_work_evidence", description: "Read one extracted document block by its Work-bound digest and locator. Never infer image or scanned-page content from extracted text.", inputSchema: { type: "object", properties: { digest: { type: "string" }, locator: { type: "string" }, reason: { type: "string" } }, required: ["digest", "locator", "reason"], additionalProperties: false }, invoke: async (value: unknown) => {
          const input = value as { digest: string; locator: string; reason: string };
          if (!/^[a-f0-9]{64}$/u.test(input.digest) || !input.reason?.trim() || input.reason.length > 500) throw new Error("Invalid evidence read request");
          const event = this.getTrace(work.id).find((item) => item.type === "context.external" && (item.payload as { object?: { digest?: string } }).object?.digest === input.digest);
          const extraction = (event?.payload as { extraction?: { digest: string } } | undefined)?.extraction;
          if (!extraction) throw new Error("No readable extraction for this Work evidence");
          const projection = JSON.parse(new TextDecoder().decode(await this.options.store.getObject(extraction.digest))) as WorkEvidenceExtraction;
          const block = projection.blocks.find((item) => item.locator === input.locator);
          if (!block) throw new Error("Evidence locator is not available");
          await this.#traceEvent(work.id, "context.retrieved", "agent", { source: "work-evidence", digest: input.digest, locator: input.locator, textDigest: hash(block.text), reason: input.reason });
          return { ...block, documentDigest: input.digest, warnings: projection.warnings };
        } },
      ] satisfies HarnessTool[] : []),
      { name: "airic_read_work_document", description: "Load an on-demand Work Definition document for the next reasoning step.", inputSchema: { type: "object", properties: { id: { type: "string" }, reason: { type: "string" } }, required: ["id", "reason"] }, invoke: async (value) => { const input = value as { id: string; reason: string }; const revised = await this.selectContent(work.id, input.id, input.reason); const current = await this.#definitionFor(revised); const doc = current.documents.get(input.id); if (!doc) throw new Error(`Work Definition document ${input.id} changed before it could be read`); return { id: doc.id, content: doc.content, digest: doc.digest, workRevision: revised.revision }; } },
      { name: "airic_read_domain_source", description: "Read reviewed domain source tied to the active release.", inputSchema: { type: "object", properties: { domainId: { type: "string" }, path: { type: "string" }, symbol: { type: "string" }, reason: { type: "string" } }, required: ["domainId", "path", "reason"] }, invoke: async (value) => { const input = value as { domainId: string; path: string; symbol?: string; reason: string }; const module = domains.find((candidate) => candidate.id === input.domainId); if (!module?.readSource) throw new Error(`Domain source is unavailable for ${input.domainId}`); const result = await module.readSource({ path: input.path, ...(input.symbol ? { symbol: input.symbol } : {}) }); await this.#traceEvent(work.id, "context.retrieved", "agent", { source: "domain", domainId: module.id, release: module.release, locator: result.locator, digest: hash(result.content), reason: input.reason }); return result; } },
      { name: "airic_read_work_trace", description: "Read this Work trace, or a trajectory explicitly bound to a trusted Reflection Work.", inputSchema: { type: "object", properties: { workId: { type: "string" }, reason: { type: "string" } }, required: ["reason"] }, invoke: async (value) => { const input = value as { workId?: string; reason: string }; const sourceWorkId = input.workId ?? work.id; if (sourceWorkId !== work.id && (!this.#isReflection(work) || !work.sourceWorks.some((source) => source.workId === sourceWorkId))) throw new Error("ReflectionSourceMismatch"); const sourceWork = this.#requireWork(sourceWorkId); await this.#authorize(actor, sourceWork, "read-trace"); await this.options.onTraceRead?.(actor, sourceWork, input.reason); const events = this.getTrace(sourceWorkId); if (!events.length) throw new Error(`No readable trace for Work ${sourceWorkId}`); await this.#traceEvent(work.id, "context.retrieved", "agent", { source: "trace", sourceWorkId, eventCount: events.length, reason: input.reason }); return events; } },
      ...(this.#isAuthoring(work) ? [
        { name: "airic_list_operating_models", description: "List installation-owned Operating Models available to this authoring Work.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, invoke: async () => this.options.operatingModels.listAvailableModels() },
        { name: "airic_read_operating_model", description: "Read one immutable Operating Model revision before proposing a candidate.", inputSchema: { type: "object", properties: { moduleId: { type: "string" }, workTypeId: { type: "string" }, revisionId: { type: "string" }, contentDigest: { type: "string" } }, required: ["moduleId", "workTypeId"] }, invoke: async (value) => { const input = value as { moduleId: string; workTypeId: string; revisionId?: string; contentDigest?: string }; const target = { moduleId: input.moduleId, workTypeId: input.workTypeId }; const active = await this.options.operatingModels.resolveActive(target); const ref = input.revisionId && input.contentDigest ? { revisionId: input.revisionId, contentDigest: input.contentDigest } : active; const snapshot = await this.options.operatingModels.readRevision(target, ref); await this.#traceEvent(work.id, "context.retrieved", "agent", { source: "operating-model", target, ref }); return snapshot; } },
        { name: "airic_record_operating_model_candidate", description: "Submit a structure-validated Operating Model change set for human review.", inputSchema: { type: "object", properties: { target: { type: "object" }, baseRevision: { type: "object" }, changeSet: { type: "object" }, rationale: { type: "string" }, evidenceRefs: { type: "array" }, supersedesProposalId: { type: "string" } }, required: ["target", "baseRevision", "changeSet", "rationale", "evidenceRefs"] }, invoke: async (value) => this.recordOperatingModelCandidate(work.id, value as Parameters<AiricRuntime["recordOperatingModelCandidate"]>[1]) },
      ] satisfies HarnessTool[] : []),
      { name: "airic_record_reflection_candidate", description: "Store a reviewable candidate diff linked to trace evidence.", inputSchema: { type: "object", properties: { targetKind: { enum: ["operating-model", "domain", "associated"] }, targetPath: { type: "string" }, target: { type: "object", properties: { moduleId: { type: "string" }, workTypeId: { type: "string" } }, required: ["moduleId", "workTypeId"] }, baseCommit: { type: "string" }, baseContentDigest: { type: "string" }, diff: { type: "string" }, rationale: { type: "string" }, evidenceEventIds: { type: "array", items: { type: "string" } } }, required: ["targetKind", "targetPath", "baseContentDigest", "diff", "rationale", "evidenceEventIds"] }, invoke: async (value) => { if (work.workType.workTypeId !== "reflection") throw new Error("Reflection candidates can only be produced by a Reflection Work"); return this.recordReflectionCandidate(work.id, value as Parameters<AiricRuntime["recordReflectionCandidate"]>[1]); } },
      { name: "airic_complete_work", description: "Complete the Work with a structured result after required domain effects are confirmed.", inputSchema: { type: "object", properties: { result: {} }, required: ["result"] }, invoke: async (value) => this.completeWork(work.id, (value as { result: unknown }).result) },
    ];
  }

  async #invokeCapability(workId: string, module: DomainProvider, capabilityId: string, input: unknown, requestId: string, actor: TrustedCallContext["actor"]): Promise<unknown> {
    const work = this.#requireOpenWork(workId);
    await this.#authorize(actor, work, "capability");
    const binding = work.domainBindings.find((candidate) => candidate.id === module.id);
    if (!binding || binding.release !== module.release || binding.buildId !== module.buildId || binding.sourceDigest !== module.sourceBundle.digest) throw new Error(`BindingChanged: ${module.id}`);
    const capability = module.capabilities.find((candidate) => candidate.id === capabilityId);
    if (!capability) throw new Error(`Unknown capability ${capabilityId}`);
    const definition = await this.#definitionFor(work);
    if (!definition.manifest.capabilities.allowed.includes(capabilityId)) throw new Error(`CapabilityRevoked: ${capabilityId}`);
    await this.#traceEvent(workId, "tool.called", "agent", { capabilityId, kind: capability.kind, requestId, input });
    if (capability.kind !== "command") {
      const result = await capability.invoke(this.#callContext(work, module, definition, actor), input);
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
      const raw = await capability.invoke(this.#callContext(work, module, definition, actor, action), input);
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

  #callContext(work: Work, module: DomainProvider, definition: WorkDefinition, actor: TrustedCallContext["actor"], action?: Action): TrustedCallContext {
    return { actor, workId: work.id, workType: { ...work.workType, operatingDigest: definition.digest }, expectedDomainRelease: module.release, ...(action ? { actionId: action.id, commandId: action.commandId } : {}) };
  }
  async #authorize(actor: TrustedCallContext["actor"], work: Work, action: "prompt" | "capability" | "read-trace"): Promise<void> {
    if (this.options.authorizeWork && !await this.options.authorizeWork(actor, work, action)) throw new Error("WorkAccessDenied");
  }
  #domainsFor(work: Work): DomainProvider[] { const resolved = this.options.modules.resolve(work.workType).domains; return work.domainBindings.map((binding) => resolved.find((module) => module.id === binding.id) ?? fail(`Domain ${binding.id} is not available to ${work.workType.moduleId}/${work.workType.workTypeId}`)); }
  async #definitionFor(work: Work): Promise<WorkDefinition> {
    this.options.modules.resolve(work.workType);
    const target = work.workType;
    const ref = this.#turnRevisions.get(work.id) ?? await this.options.operatingModels.resolveActive(target);
    return loadWorkDefinition(await this.options.operatingModels.readRevision(target, ref));
  }
  async #assembleAndTrace(work: Work, domains: readonly DomainProvider[], sequence: number, reason?: string, turnContextRefs?: readonly TurnContextRef[]): Promise<{ definition: WorkDefinition; envelope: ReturnType<typeof assembleContext> }> {
    const definition = await this.#definitionFor(work);
    const operatingModelRevision = this.#turnRevisions.get(work.id) ?? await this.options.operatingModels.resolveActive(work.workType);
    const allowed = new Set(definition.manifest.capabilities.allowed);
    const authorizedDomains = domains.map((domain) => ({ ...domain, capabilities: domain.capabilities.filter((capability) => allowed.has(capability.id)) }));
    const envelope = assembleContext({ work, definition, domains: authorizedDomains, sequence, ...(turnContextRefs === undefined ? {} : { turnContextRefs }) });
    const previous = this.getTrace(work.id).filter((event) => event.type === "context.assembled").at(-1);
    const previousRevision = (previous?.payload as { operatingModelRevision?: OperatingModelRevisionRef } | undefined)?.operatingModelRevision;
    if (previousRevision && (previousRevision.revisionId !== operatingModelRevision.revisionId || previousRevision.contentDigest !== operatingModelRevision.contentDigest)) {
      await this.#traceEvent(work.id, "context.operating-model-changed", "runtime", { previous: previousRevision, current: operatingModelRevision });
    }
    const evidence = [];
    for (const block of envelope.instructions) {
      const object = await this.options.store.putObject(new TextEncoder().encode(block.content));
      evidence.push({ id: block.id, digest: block.digest, object });
    }
    await this.#traceEvent(work.id, "context.assembled", "runtime", {
      envelopeId: envelope.envelopeId, digest: envelope.digest, workType: envelope.workType,
      sources: envelope.provenance, availableCapabilities: envelope.availableCapabilities, evidence, operatingModelRevision, ...(reason ? { reason } : {}), ...(turnContextRefs?.length ? { turnContextRefs } : {}),
    });
    return { definition, envelope };
  }
  #requireWork(id: string): Work { return this.#works.get(id) ?? fail(`Unknown Work ${id}`); }
  #isReflectionRef(ref: Work["workType"]): boolean { return this.options.operatingModelAuthoringWorkTypes?.reflection.some((item) => item.moduleId === ref.moduleId && item.workTypeId === ref.workTypeId) ?? false; }
  #isReflection(work: Work): boolean { return this.#isReflectionRef(work.workType); }
  #isSmith(work: Work): boolean { return this.options.operatingModelAuthoringWorkTypes?.smith.some((item) => item.moduleId === work.workType.moduleId && item.workTypeId === work.workType.workTypeId) ?? false; }
  #isAuthoring(work: Work): boolean { return this.#isReflection(work) || this.#isSmith(work); }
  #trajectoryRevisions(workId: string): readonly OperatingModelRevisionRef[] { const values = this.getTrace(workId).filter((event) => event.type === "context.assembled").map((event) => (event.payload as { operatingModelRevision?: OperatingModelRevisionRef }).operatingModelRevision).filter((ref): ref is OperatingModelRevisionRef => Boolean(ref)); return values.filter((ref, index) => values.findIndex((value) => value.revisionId === ref.revisionId && value.contentDigest === ref.contentDigest) === index); }
  #requireOpenWork(id: string): Work { const work = this.#requireWork(id); if (work.status !== "open") throw new Error(`Work ${id} is ${work.status}`); return work; }
  async #saveAction(action: Action, type: TraceEvent["type"], payload: unknown): Promise<void> { await this.#persist([{ kind: "action.saved", action }]); await this.#traceEvent(action.workId, type, "runtime", payload, action.id); }
  async #traceEvent(workId: string, type: TraceEvent["type"], actor: string, payload: unknown, actionId?: string): Promise<void> {
    const event: TraceEvent = { schemaVersion: 1, eventId: this.#id(), workId, type, timestamp: this.#now().toISOString(), actor, payload, ...(actionId ? { actionId } : {}) };
    await this.#persist([{ kind: "trace.appended", event }]);
  }
  async #persist(events: readonly RuntimeEvent[]): Promise<void> { await this.options.store.append(events); for (const event of events) this.#apply(event); }
  #apply(event: RuntimeEvent): void {
    if (event.kind === "work.saved") this.#works.set(event.work.id, { ...event.work, sourceWorks: event.work.sourceWorks ?? [] });
    else if (event.kind === "action.saved") this.#actions.set(event.action.id, event.action);
    else { this.#trace.push(event.event); for (const listener of this.#listeners) listener(event.event); }
  }
}

export function toolName(capabilityId: string): string { return `domain_${capabilityId.replace(/[^a-zA-Z0-9_-]/g, "_")}`; }
function asObject(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : { value }; }
function fail(message: string): never { throw new Error(message); }
