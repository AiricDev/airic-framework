import { describe, expect, it } from "vitest";
import { loadWorkDefinition } from "@airic/framework";
import { MemoryOperatingModelRepository } from "@airic/testing";

const manifest = { schemaVersion: 1, id: "reflection", title: "Reflection", capabilities: { allowed: [] }, documents: [{ id: "method", path: "method.md", title: "Method", role: "reflection", load: "required", requires: [] }], completion: { requiredCapabilities: [] } };

describe("OperatingModelService", () => {
  it("materializes, validates and adopts the exact whole-package candidate", async () => {
    const models = new MemoryOperatingModelRepository({ "development/reflection": { manifest, documents: { "method.md": "Inspect evidence." } } });
    const target = { moduleId: "development", workTypeId: "reflection" }; const base = await models.resolveActive(target);
    const nextManifest = { ...manifest, documents: [...manifest.documents, { id: "examples", path: "examples.md", title: "Examples", role: "reference" as const, load: "on-demand" as const, requires: [] }] };
    const proposal = await models.propose({ operationId: "candidate-1", target, baseRevision: base, changeSet: { upsert: [{ path: "work.yml", content: JSON.stringify(nextManifest) }, { path: "examples.md", content: "Use only trace-backed patterns." }], delete: [] }, rationale: "Make counterexamples available on demand", evidenceRefs: [], provenance: { trajectoryRevisions: [] }, proposer: { kind: "smith", id: "agent" } });
    expect(proposal.status).toBe("committed"); if (proposal.status !== "committed" || !("proposalId" in proposal.result)) throw new Error("proposal missing");
    const detail = await models.getProposalDetail(proposal.result.proposalId); expect(detail?.proposal.validation.checks).toEqual([{ id: "package-structure", status: "passed" }]); expect((await loadWorkDefinition(detail!.candidate)).documents.get("examples")?.content).toContain("trace-backed");
    const review = await models.review({ operationId: "review-1", proposalId: detail!.proposal.proposalId, proposalDigest: detail!.proposal.candidateDigest, validationReceiptDigest: detail!.proposal.validation.receiptDigest, decision: "approved", reviewer: "owner" });
    expect(review.status).toBe("committed"); if (review.status !== "committed" || !("reviewId" in review.result)) throw new Error("review missing");
    const adopted = await models.adopt({ operationId: "adopt-1", proposalId: detail!.proposal.proposalId, expectedActiveRevision: base, proposalDigest: detail!.proposal.candidateDigest, reviewId: review.result.reviewId, reviewDigest: review.result.reviewDigest, reviewer: "owner" });
    expect(adopted.status).toBe("committed"); const active = await models.readRevision(target, await models.resolveActive(target)); expect(active.files.find((file) => file.path === "examples.md")?.content).toContain("trace-backed");
  });

  it("rejects incomplete packages before review", async () => {
    const models = new MemoryOperatingModelRepository({ "development/reflection": { manifest, documents: { "method.md": "Inspect evidence." } } }); const target = { moduleId: "development", workTypeId: "reflection" };
    const outcome = await models.propose({ operationId: "invalid-1", target, baseRevision: await models.resolveActive(target), changeSet: { upsert: [], delete: ["work.yml"] }, rationale: "Broken", evidenceRefs: [], provenance: { trajectoryRevisions: [] }, proposer: { kind: "human", id: "owner" } });
    expect(outcome).toMatchObject({ status: "rejected", error: { code: "ValidationFailed" } });
  });
});
