/** Immutable Operating Model assets and the narrow ports used by their consumers. */
export interface OperatingModelId { moduleId: string; workTypeId: string }
export interface OperatingModelRevisionRef { revisionId: string; contentDigest: string }
export interface OperatingModelDocument { path: string; content: string; digest: string }
export interface OperatingModelSnapshot {
  target: OperatingModelId;
  ref: OperatingModelRevisionRef;
  parentRef?: OperatingModelRevisionRef;
  manifest: unknown;
  documents: readonly OperatingModelDocument[];
  sourceRef?: string;
}
export interface OperatingModelProposal {
  proposalId: string;
  target: OperatingModelId;
  baseRevision: OperatingModelRevisionRef;
  candidateDigest: string;
  patch: string;
  rationale: string;
  evidenceRefs: readonly { workId: string; eventId: string }[];
  validationPlan: unknown;
  proposer: { kind: "human" | "reflection"; id: string };
  status: "open" | "approved" | "rejected" | "adopted" | "stale";
  supersedesProposalId?: string;
}
export interface OperatingModelReview {
  reviewId: string;
  reviewDigest: string;
  proposalId: string;
  proposalDigest: string;
  decision: "approved" | "rejected";
  reviewer: string;
  comment?: string;
  validationRequirements: unknown;
}
export interface OperatingModelAdoption {
  adoptionId: string;
  proposalId: string;
  previousActive: OperatingModelRevisionRef;
  activeRevision: OperatingModelRevisionRef;
  reviewBinding: { reviewId: string; proposalDigest: string };
  validationEvidence: unknown;
}
export type OperatingModelOperation =
  | { operationId: string; status: "committed"; result: OperatingModelProposal | OperatingModelReview | OperatingModelAdoption }
  | { operationId: string; status: "pending" | "unknown" }
  | { operationId: string; status: "rejected"; error: { code: string; message: string; details?: unknown } };

/** Runtime may resolve and read active immutable assets; it cannot govern them. */
export interface OperatingModelRuntimePort {
  resolveActive(target: OperatingModelId): Promise<OperatingModelRevisionRef>;
  readRevision(target: OperatingModelId, ref: OperatingModelRevisionRef): Promise<OperatingModelSnapshot>;
  listAvailableModels(): Promise<readonly OperatingModelId[]>;
}

/** Reflection may submit evidence-linked proposals; it cannot review or adopt. */
export interface OperatingModelLearningPort {
  proposeFromReflection(input: Omit<OperatingModelProposal, "proposalId" | "candidateDigest" | "status" | "proposer"> & { operationId: string; sourceWorkId: string; proposerId: string }): Promise<OperatingModelOperation>;
}

/** A trusted human governance host owns proposal review and adoption commands. */
export interface OperatingModelGovernancePort {
  propose(input: Omit<OperatingModelProposal, "proposalId" | "candidateDigest" | "status"> & { operationId: string }): Promise<OperatingModelOperation>;
  getProposal(proposalId: string): Promise<OperatingModelProposal | undefined>;
  listProposals(target?: OperatingModelId): Promise<readonly OperatingModelProposal[]>;
  review(input: { operationId: string; proposalId: string; proposalDigest: string; decision: "approved" | "rejected"; reviewer: string; comment?: string; validationRequirements: unknown }): Promise<OperatingModelOperation>;
  reject(input: { operationId: string; proposalId: string; reviewer: string; comment?: string }): Promise<OperatingModelOperation>;
  adopt(input: { operationId: string; proposalId: string; expectedActiveRevision: OperatingModelRevisionRef; proposalDigest: string; reviewId: string; reviewDigest: string; reviewer: string }): Promise<OperatingModelOperation>;
  inspectOperation(operationId: string): Promise<OperatingModelOperation | undefined>;
}

/** Composition-only type. Consumers must receive one of the narrow ports above. */
export type OperatingModelRepository = OperatingModelRuntimePort & OperatingModelLearningPort & OperatingModelGovernancePort;

export class OperatingModelRepositoryError extends Error {
  constructor(readonly code: "OperatingModelNotFound" | "RevisionNotFound" | "ProposalNotFound" | "BaseRevisionConflict" | "ProposalStateConflict" | "ReviewRequired" | "ValidationFailed", message: string, readonly details?: unknown) { super(message); }
}
