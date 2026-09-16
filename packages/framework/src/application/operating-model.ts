import { createHash } from "node:crypto";
import { loadWorkDefinition } from "./work-definition.js";

/** Immutable, installation-owned Work Definition packages. */
export interface OperatingModelId { moduleId: string; workTypeId: string }
export interface OperatingModelRevisionRef { revisionId: string; contentDigest: string }
export interface OperatingModelFile { path: string; content: string; digest: string }
export interface OperatingModelSnapshot { target: OperatingModelId; ref: OperatingModelRevisionRef; parentRef?: OperatingModelRevisionRef; /** `work.yml` is authoritative. */ files: readonly OperatingModelFile[]; sourceRef?: string }
export interface OperatingModelChangeSet { upsert: readonly { path: string; content: string }[]; delete: readonly string[] }
export interface OperatingModelValidationReceipt { receiptDigest: string; candidateRevision: OperatingModelRevisionRef; checks: readonly { id: "package-structure" | "capability-availability"; status: "passed" }[] }
export interface OperatingModelProvenance { authoringWorkId?: string; authoringRevision?: OperatingModelRevisionRef; trajectoryRevisions: readonly { workId: string; revisions: readonly OperatingModelRevisionRef[] }[] }
export interface OperatingModelProposal {
  proposalId: string; target: OperatingModelId; baseRevision: OperatingModelRevisionRef; candidateRevision: OperatingModelRevisionRef; candidateDigest: string; changeSet: OperatingModelChangeSet; rationale: string;
  evidenceRefs: readonly { workId: string; eventId: string }[]; validation: OperatingModelValidationReceipt; provenance: OperatingModelProvenance;
  proposer: { kind: "human" | "reflection" | "smith"; id: string }; status: "open" | "approved" | "rejected" | "adopted" | "stale"; supersedesProposalId?: string;
}
export interface OperatingModelReview { reviewId: string; reviewDigest: string; proposalId: string; proposalDigest: string; validationReceiptDigest: string; decision: "approved" | "rejected"; reviewer: string; comment?: string }
export interface OperatingModelAdoption { adoptionId: string; proposalId: string; previousActive: OperatingModelRevisionRef; activeRevision: OperatingModelRevisionRef; reviewBinding: { reviewId: string; proposalDigest: string; validationReceiptDigest: string } }
export interface OperatingModelProposalDetail { proposal: OperatingModelProposal; candidate: OperatingModelSnapshot; review?: OperatingModelReview; diff: OperatingModelChangeSet }
export type OperatingModelOperation =
  | { operationId: string; status: "committed"; result: OperatingModelProposal | OperatingModelReview | OperatingModelAdoption }
  | { operationId: string; status: "pending" | "unknown" }
  | { operationId: string; status: "rejected"; error: { code: string; message: string; details?: unknown } };

export interface OperatingModelRuntimePort { resolveActive(target: OperatingModelId): Promise<OperatingModelRevisionRef>; readRevision(target: OperatingModelId, ref: OperatingModelRevisionRef): Promise<OperatingModelSnapshot>; listAvailableModels(): Promise<readonly OperatingModelId[]>; listRevisions(target: OperatingModelId): Promise<readonly OperatingModelRevisionRef[]> }
export interface OperatingModelAuthoringPort {
  propose(input: { operationId: string; target: OperatingModelId; baseRevision: OperatingModelRevisionRef; changeSet: OperatingModelChangeSet; rationale: string; evidenceRefs: readonly { workId: string; eventId: string }[]; provenance: OperatingModelProvenance; proposer: OperatingModelProposal["proposer"]; supersedesProposalId?: string }): Promise<OperatingModelOperation>;
  getProposal(proposalId: string): Promise<OperatingModelProposal | undefined>;
}
export interface OperatingModelGovernancePort extends OperatingModelAuthoringPort {
  getProposalDetail(proposalId: string): Promise<OperatingModelProposalDetail | undefined>; listProposals(target?: OperatingModelId): Promise<readonly OperatingModelProposal[]>;
  review(input: { operationId: string; proposalId: string; proposalDigest: string; validationReceiptDigest: string; decision: "approved" | "rejected"; reviewer: string; comment?: string }): Promise<OperatingModelOperation>;
  reject(input: { operationId: string; proposalId: string; reviewer: string; comment?: string }): Promise<OperatingModelOperation>;
  adopt(input: { operationId: string; proposalId: string; expectedActiveRevision: OperatingModelRevisionRef; proposalDigest: string; reviewId: string; reviewDigest: string; reviewer: string }): Promise<OperatingModelOperation>;
  inspectOperation(operationId: string): Promise<OperatingModelOperation | undefined>;
}
/** Storage is a mechanism. It stores immutable values and performs compare-and-swap writes. */
export interface OperatingModelStorePort extends OperatingModelRuntimePort {
  bootstrap(snapshot: OperatingModelSnapshot, operationId?: string): Promise<OperatingModelRevisionRef>;
  putProposal(input: { operationId: string; proposal: OperatingModelProposal; candidate: OperatingModelSnapshot }): Promise<OperatingModelOperation>;
  getProposal(proposalId: string): Promise<OperatingModelProposal | undefined>; getCandidate(proposalId: string): Promise<OperatingModelSnapshot | undefined>; listProposals(target?: OperatingModelId): Promise<readonly OperatingModelProposal[]>;
  getReview(proposalId: string): Promise<OperatingModelReview | undefined>; putReview(input: { operationId: string; review: OperatingModelReview }): Promise<OperatingModelOperation>;
  adoptCandidate(input: { operationId: string; proposal: OperatingModelProposal; review: OperatingModelReview; expectedActiveRevision: OperatingModelRevisionRef }): Promise<OperatingModelOperation>;
  inspectOperation(operationId: string): Promise<OperatingModelOperation | undefined>;
}

/** Framework-owned policy around candidate materialization, validation, review and adoption. */
export class OperatingModelService implements OperatingModelRuntimePort, OperatingModelGovernancePort {
  constructor(readonly store: OperatingModelStorePort, readonly options: { availableCapabilities?: (target: OperatingModelId) => Promise<readonly string[]> } = {}) {}
  bootstrap(snapshot: OperatingModelSnapshot, operationId?: string) { return this.store.bootstrap(normalizeSnapshot(snapshot), operationId); }
  resolveActive(target: OperatingModelId) { return this.store.resolveActive(target); }
  readRevision(target: OperatingModelId, ref: OperatingModelRevisionRef) { return this.store.readRevision(target, ref); }
  listAvailableModels() { return this.store.listAvailableModels(); }
  listRevisions(target: OperatingModelId) { return this.store.listRevisions(target); }
  async propose(input: Parameters<OperatingModelAuthoringPort["propose"]>[0]): Promise<OperatingModelOperation> {
    const existing = await this.store.inspectOperation(input.operationId); if (existing) return existing;
    const active = await this.store.resolveActive(input.target); if (!sameRef(active, input.baseRevision)) return rejected(input.operationId, "BaseRevisionConflict", "Proposal base is not active");
    const base = await this.store.readRevision(input.target, active); let candidate: OperatingModelSnapshot;
    try { candidate = materializeCandidate(base, input.changeSet); await loadWorkDefinition(candidate); } catch (error) { return rejected(input.operationId, "ValidationFailed", error instanceof Error ? error.message : "Invalid Operating Model package"); }
    const checks: Array<{ id: "package-structure" | "capability-availability"; status: "passed" }> = [{ id: "package-structure", status: "passed" }];
    if (this.options.availableCapabilities) {
      const available = new Set(await this.options.availableCapabilities(input.target)); const definition = await loadWorkDefinition(candidate); const missing = definition.manifest.capabilities.allowed.filter((id) => !available.has(id));
      if (missing.length) return rejected(input.operationId, "ValidationFailed", `Definition allows unavailable capabilities: ${missing.join(", ")}`); checks.push({ id: "capability-availability", status: "passed" });
    }
    const validation: OperatingModelValidationReceipt = { candidateRevision: candidate.ref, checks, receiptDigest: digest(stable({ candidate: candidate.ref, checks })) };
    const proposal: OperatingModelProposal = { proposalId: `proposal:${input.operationId}`, target: input.target, baseRevision: active, candidateRevision: candidate.ref, candidateDigest: candidate.ref.contentDigest, changeSet: normalizeChangeSet(input.changeSet), rationale: input.rationale, evidenceRefs: input.evidenceRefs, validation, provenance: input.provenance, proposer: input.proposer, status: "open", ...(input.supersedesProposalId ? { supersedesProposalId: input.supersedesProposalId } : {}) };
    return this.store.putProposal({ operationId: input.operationId, proposal, candidate });
  }
  getProposal(proposalId: string) { return this.store.getProposal(proposalId); }
  async getProposalDetail(proposalId: string): Promise<OperatingModelProposalDetail | undefined> { const proposal = await this.store.getProposal(proposalId); const candidate = await this.store.getCandidate(proposalId); if (!proposal || !candidate) return undefined; const review = await this.store.getReview(proposalId); return { proposal, candidate, ...(review ? { review } : {}), diff: proposal.changeSet }; }
  listProposals(target?: OperatingModelId) { return this.store.listProposals(target); }
  async review(input: Parameters<OperatingModelGovernancePort["review"]>[0]): Promise<OperatingModelOperation> {
    const existing = await this.store.inspectOperation(input.operationId); if (existing) return existing; const proposal = await this.store.getProposal(input.proposalId);
    if (!proposal || proposal.candidateDigest !== input.proposalDigest || proposal.validation.receiptDigest !== input.validationReceiptDigest) return rejected(input.operationId, "ProposalNotFound", "Proposal or validation receipt is not current");
    if (proposal.status !== "open") return rejected(input.operationId, "ProposalStateConflict", "Only an open proposal may be reviewed");
    const basis = { reviewId: `review:${input.operationId}`, proposalId: proposal.proposalId, proposalDigest: proposal.candidateDigest, validationReceiptDigest: proposal.validation.receiptDigest, decision: input.decision, reviewer: input.reviewer, ...(input.comment ? { comment: input.comment } : {}) };
    return this.store.putReview({ operationId: input.operationId, review: { ...basis, reviewDigest: digest(stable(basis)) } });
  }
  async reject(input: Parameters<OperatingModelGovernancePort["reject"]>[0]) { const proposal = await this.store.getProposal(input.proposalId); return this.review({ operationId: input.operationId, proposalId: input.proposalId, proposalDigest: proposal?.candidateDigest ?? "", validationReceiptDigest: proposal?.validation.receiptDigest ?? "", decision: "rejected", reviewer: input.reviewer, ...(input.comment ? { comment: input.comment } : {}) }); }
  async adopt(input: Parameters<OperatingModelGovernancePort["adopt"]>[0]): Promise<OperatingModelOperation> {
    const existing = await this.store.inspectOperation(input.operationId); if (existing) return existing; const proposal = await this.store.getProposal(input.proposalId); const review = await this.store.getReview(input.proposalId);
    if (!proposal || !review || proposal.status !== "approved" || review.reviewId !== input.reviewId || review.reviewDigest !== input.reviewDigest || review.proposalDigest !== input.proposalDigest || review.decision !== "approved") return rejected(input.operationId, "ReviewRequired", "A matching approved review is required");
    return this.store.adoptCandidate({ operationId: input.operationId, proposal, review, expectedActiveRevision: input.expectedActiveRevision });
  }
  inspectOperation(operationId: string) { return this.store.inspectOperation(operationId); }
}

export function materializeCandidate(base: OperatingModelSnapshot, changeSet: OperatingModelChangeSet): OperatingModelSnapshot {
  const changes = normalizeChangeSet(changeSet); const files = new Map(base.files.map((file) => [file.path, file.content])); for (const path of changes.delete) files.delete(path); for (const item of changes.upsert) files.set(item.path, item.content);
  if (!files.has("work.yml")) throw new Error("Operating Model candidate must contain work.yml"); const normalized = [...files.entries()].map(([path, content]) => ({ path, content, digest: digest(content) })).sort((a, b) => a.path.localeCompare(b.path)); const contentDigest = digest(stable(normalized.map(({ path, content }) => ({ path, content }))));
  return { target: base.target, ref: { revisionId: `candidate:${contentDigest.slice(0, 16)}`, contentDigest }, parentRef: base.ref, files: normalized };
}
export function normalizeSnapshot(snapshot: OperatingModelSnapshot): OperatingModelSnapshot { const seen = new Set<string>(); const files = snapshot.files.map((file) => { assertSafePath(file.path); if (seen.has(file.path)) throw new Error(`Duplicate Operating Model path: ${file.path}`); seen.add(file.path); return { path: file.path, content: file.content, digest: digest(file.content) }; }).sort((a, b) => a.path.localeCompare(b.path)); if (!seen.has("work.yml")) throw new Error("Operating Model package must contain work.yml"); const contentDigest = digest(stable(files.map(({ path, content }) => ({ path, content })))); if (snapshot.ref.contentDigest !== contentDigest) throw new Error("Operating Model snapshot content digest mismatch"); return { ...snapshot, files }; }
export function normalizeChangeSet(changeSet: OperatingModelChangeSet): OperatingModelChangeSet { const paths = new Set<string>(); const upsert = [...changeSet.upsert].map((item) => { assertSafePath(item.path); if (paths.has(item.path)) throw new Error(`Duplicate candidate change: ${item.path}`); paths.add(item.path); return { path: item.path, content: item.content }; }).sort((a, b) => a.path.localeCompare(b.path)); const remove = [...changeSet.delete].map((path) => { assertSafePath(path); if (paths.has(path)) throw new Error(`Candidate both deletes and writes ${path}`); paths.add(path); return path; }).sort(); if (!upsert.length && !remove.length) throw new Error("Operating Model candidate contains no changes"); return { upsert, delete: remove }; }
export function sameRef(left: OperatingModelRevisionRef, right: OperatingModelRevisionRef): boolean { return left.revisionId === right.revisionId && left.contentDigest === right.contentDigest; }
export function targetKey(target: OperatingModelId): string { return `${target.moduleId}/${target.workTypeId}`; }
export function parseTarget(value: string): OperatingModelId { const [moduleId, workTypeId] = value.split("/"); return { moduleId: moduleId!, workTypeId: workTypeId! }; }
export function snapshotKey(target: OperatingModelId, ref: OperatingModelRevisionRef): string { return `${targetKey(target)}@${ref.revisionId}:${ref.contentDigest}`; }
export function rejected(operationId: string, code: string, message: string): OperatingModelOperation { return { operationId, status: "rejected", error: { code, message } }; }
export function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function stable(value: unknown): string { if (Array.isArray(value)) return `[${value.map((child) => stable(child === undefined ? null : child)).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",")}}`; return JSON.stringify(value) ?? "null"; }
function assertSafePath(path: string): void { if (!path || path.startsWith("/") || path.split("/").includes("..")) throw new Error(`Unsafe Operating Model path: ${path}`); }
export class OperatingModelRepositoryError extends Error { constructor(readonly code: "OperatingModelNotFound" | "RevisionNotFound" | "ProposalNotFound" | "BaseRevisionConflict" | "ProposalStateConflict" | "ReviewRequired" | "ValidationFailed", message: string, readonly details?: unknown) { super(message); } }
