import { createHash } from "node:crypto";
import type { AgentHarness, ContextEnvelope, DeliveryRecord, HarnessEvent, HarnessTool, OperatingModelAdoption, OperatingModelId, OperatingModelOperation, OperatingModelProposal, OperatingModelRepository, OperatingModelRevisionRef, OperatingModelReview, OperatingModelSnapshot } from "@airic/framework";

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
    workId: string; workInput: unknown; message: string; envelope: ContextEnvelope; tools: readonly HarnessTool[]; refreshContext(): Promise<ContextEnvelope>; signal?: AbortSignal;
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

export class MemoryModuleSource {
  constructor(
    readonly modules: Record<string, { manifest: unknown }>,
    readonly definitions: Record<string, { manifest: unknown; documents: Record<string, string> }>,
  ) {}
  async listModules(): Promise<readonly string[]> { return Object.keys(this.modules); }
  async readModuleManifest(id: string): Promise<unknown> { return this.modules[id]?.manifest ?? missing(id); }
}

/** Test-only immutable repository with the same narrow public contract. */
export class MemoryOperatingModelRepository implements OperatingModelRepository {
  #snapshots = new Map<string, OperatingModelSnapshot>(); #active = new Map<string, OperatingModelRevisionRef>(); #proposals = new Map<string, OperatingModelProposal>(); #operations = new Map<string, OperatingModelOperation>(); #reviews = new Map<string, { proposalId: string; digest: string; decision: "approved" | "rejected" }>();
  constructor(definitions: Record<string, { manifest: unknown; documents: Record<string, string> }>) {
    for (const [key, value] of Object.entries(definitions)) { const [moduleId, workTypeId] = key.split("/"); const target = { moduleId: moduleId!, workTypeId: workTypeId! }; const contentDigest = digest(JSON.stringify(value)); const ref = { revisionId: `baseline:${contentDigest.slice(0, 12)}`, contentDigest }; const snapshot = { target, ref, manifest: value.manifest, documents: [{ path: "work.yml", content: JSON.stringify(value.manifest), digest: digest(JSON.stringify(value.manifest)) }, ...Object.entries(value.documents).map(([path, content]) => ({ path, content, digest: digest(content) }))] }; this.#snapshots.set(this.#key(target, ref), snapshot); this.#active.set(this.#targetKey(target), ref); }
  }
  async resolveActive(target: OperatingModelId) { const ref = this.#active.get(this.#targetKey(target)); if (!ref) throw new Error("OperatingModelNotFound"); return ref; }
  async readRevision(target: OperatingModelId, ref: OperatingModelRevisionRef) { const value = this.#snapshots.get(this.#key(target, ref)); if (!value) throw new Error("RevisionNotFound"); return value; }
  async listAvailableModels() { return [...this.#active.keys()].map((key) => { const [moduleId, workTypeId] = key.split("/"); return { moduleId: moduleId!, workTypeId: workTypeId! }; }); }
  async proposeFromReflection(input: Parameters<OperatingModelRepository["proposeFromReflection"]>[0]) { return this.#propose({ ...input, proposer: { kind: "reflection", id: input.proposerId } }); }
  async propose(input: Parameters<OperatingModelRepository["propose"]>[0]) { return this.#propose(input); }
  async getProposal(id: string) { const proposal = this.#proposals.get(id); return proposal && { ...proposal, status: this.#proposalStatus(proposal.proposalId) }; }
  async listProposals(target?: OperatingModelId) { return [...this.#proposals.values()].filter((item) => !target || this.#targetKey(item.target) === this.#targetKey(target)).map((item) => ({ ...item, status: this.#proposalStatus(item.proposalId) })); }
  async review(input: Parameters<OperatingModelRepository["review"]>[0]) { const proposal = this.#proposals.get(input.proposalId); if (!proposal || proposal.candidateDigest !== input.proposalDigest) return this.#reject(input.operationId, "ProposalNotFound", "Proposal is not current"); const basis = { reviewId: `review:${input.operationId}`, proposalId: proposal.proposalId, proposalDigest: proposal.candidateDigest, decision: input.decision, reviewer: input.reviewer, ...(input.comment ? { comment: input.comment } : {}), validationRequirements: input.validationRequirements } as const; const review = { ...basis, reviewDigest: digest(JSON.stringify(basis)) }; this.#reviews.set(review.reviewId, { proposalId: proposal.proposalId, digest: review.reviewDigest, decision: review.decision }); return this.#commit(input.operationId, review); }
  async reject(input: Parameters<OperatingModelRepository["reject"]>[0]) { const proposal = this.#proposals.get(input.proposalId); if (!proposal) return this.#reject(input.operationId, "ProposalNotFound", "Unknown proposal"); const basis = { reviewId: `reject:${input.operationId}`, proposalId: proposal.proposalId, proposalDigest: proposal.candidateDigest, decision: "rejected" as const, reviewer: input.reviewer, ...(input.comment ? { comment: input.comment } : {}), validationRequirements: {} }; const review = { ...basis, reviewDigest: digest(JSON.stringify(basis)) }; this.#reviews.set(review.reviewId, { proposalId: proposal.proposalId, digest: review.reviewDigest, decision: "rejected" }); return this.#commit(input.operationId, review); }
  async adopt(input: Parameters<OperatingModelRepository["adopt"]>[0]) { const proposal = this.#proposals.get(input.proposalId); const active = proposal ? await this.resolveActive(proposal.target) : undefined; const review = this.#reviews.get(input.reviewId); if (!proposal || !active || proposal.candidateDigest !== input.proposalDigest || review?.proposalId !== proposal.proposalId || review.decision !== "approved" || review.digest !== input.reviewDigest) return this.#reject(input.operationId, "ReviewRequired", "A matching approved review is required"); if (active.revisionId !== input.expectedActiveRevision.revisionId || active.contentDigest !== input.expectedActiveRevision.contentDigest) return this.#reject(input.operationId, "BaseRevisionConflict", "Active revision changed"); const base = await this.readRevision(proposal.target, active); const contentDigest = digest(`${base.ref.contentDigest}\n${proposal.patch}`); const next = { revisionId: `adopted:${contentDigest.slice(0, 12)}`, contentDigest }; this.#snapshots.set(this.#key(proposal.target, next), { ...base, ref: next, parentRef: active, sourceRef: "memory" }); this.#active.set(this.#targetKey(proposal.target), next); return this.#commit(input.operationId, { adoptionId: `adoption:${input.operationId}`, proposalId: proposal.proposalId, previousActive: active, activeRevision: next, reviewBinding: { reviewId: input.reviewId, proposalDigest: input.proposalDigest }, validationEvidence: { status: "passed" } }); }
  async inspectOperation(id: string) { return this.#operations.get(id); }
  /** Test seam: models a governance adoption without exposing it to Runtime consumers. */
  async replaceActiveForTest(target: OperatingModelId, changes: Record<string, string>): Promise<OperatingModelRevisionRef> {
    const previous = await this.resolveActive(target); const base = await this.readRevision(target, previous);
    const documents = base.documents.map((document) => changes[document.path] === undefined ? document : { ...document, content: changes[document.path]!, digest: digest(changes[document.path]!) });
    const contentDigest = digest(JSON.stringify({ manifest: base.manifest, documents: documents.map(({ path, content }) => ({ path, content })) })); const ref = { revisionId: `test:${contentDigest.slice(0, 12)}`, contentDigest };
    this.#snapshots.set(this.#key(target, ref), { ...base, ref, parentRef: previous, documents }); this.#active.set(this.#targetKey(target), ref); return ref;
  }
  async #propose(input: Omit<OperatingModelProposal, "proposalId" | "candidateDigest" | "status"> & { operationId: string }) { const prior = this.#operations.get(input.operationId); if (prior) return prior; const candidateDigest = digest(input.patch); const proposal: OperatingModelProposal = { ...input, proposalId: `proposal:${input.operationId}`, candidateDigest, status: "open" }; this.#proposals.set(proposal.proposalId, proposal); return this.#commit(input.operationId, proposal); }
  #commit(operationId: string, result: OperatingModelProposal | OperatingModelReview | OperatingModelAdoption): OperatingModelOperation { const value: OperatingModelOperation = { operationId, status: "committed", result }; this.#operations.set(operationId, value); return value; }
  #reject(operationId: string, code: string, message: string): OperatingModelOperation { const value: OperatingModelOperation = { operationId, status: "rejected", error: { code, message } }; this.#operations.set(operationId, value); return value; }
  #key(target: OperatingModelId, ref: OperatingModelRevisionRef) { return `${this.#targetKey(target)}@${ref.revisionId}:${ref.contentDigest}`; } #targetKey(target: OperatingModelId) { return `${target.moduleId}/${target.workTypeId}`; }
  #proposalStatus(proposalId: string): OperatingModelProposal["status"] { const adopted = [...this.#operations.values()].some((operation) => operation.status === "committed" && "adoptionId" in operation.result && operation.result.proposalId === proposalId); if (adopted) return "adopted"; const decisions = [...this.#reviews.values()].filter((review) => review.proposalId === proposalId); return decisions.some((review) => review.decision === "rejected") ? "rejected" : decisions.some((review) => review.decision === "approved") ? "approved" : "open"; }
}
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function missing(id: string): never { throw new Error(`Missing fixture ${id}`); }
