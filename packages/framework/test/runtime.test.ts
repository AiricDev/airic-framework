import { describe, expect, it } from "vitest";
import { AiricRuntime, DomainInvocationError, type CommandInspection, type DomainModule } from "@airic/framework";
import { FakeHarness, MemoryDefinitionSource, MemoryRuntimeStore } from "@airic/testing";

const manifest = {
  schemaVersion: 1,
  id: "assist",
  title: "Assist",
  compatibleDomains: [{ id: "cases", release: "1.*" }],
  documents: [
    { id: "process", path: "process.md", title: "Process", role: "process", load: "required", requires: [] },
    { id: "precedent", path: "precedent.md", title: "Precedent", role: "precedent", load: "on-demand", requires: [] },
  ],
  completion: { requiredCapabilities: ["case.update"] },
} as const;
const reflectionManifest = {
  schemaVersion: 1,
  id: "reflection",
  title: "Reflection",
  compatibleDomains: [],
  documents: [{ id: "method", path: "reflection.md", title: "Method", role: "reflection", load: "required", requires: [] }],
  completion: { requiredCapabilities: [] },
} as const;

function fixture(commandMode: "committed" | "rejected" | "unknown" = "committed") {
  const receipts = new Map<string, CommandInspection>();
  let commandInvocations = 0;
  const domain: DomainModule = {
    id: "cases", release: "1.0.0", buildId: "build-1",
    sourceBundle: { id: "case-source", revision: "1", digest: "source-digest" }, readme: { path: "case.ts" },
    capabilities: [
      { id: "case.get", title: "Get", description: "Get case", kind: "query", source: { path: "case.ts" }, inputSchema: { type: "object" }, outputSchema: { type: "object" }, invoke: async () => ({ id: "one", revision: 1 }) },
      { id: "case.update", title: "Update", description: "Update case", kind: "command", source: { path: "case.ts" }, inputSchema: { type: "object" }, outputSchema: { type: "object" }, invoke: async (context) => { commandInvocations += 1; const receipt: CommandInspection = commandMode === "rejected" ? { commandId: context.commandId!, status: "rejected", error: { code: "RequiredInformationMissing", message: "More evidence is required" }, observedAt: "2026-01-01T00:00:00Z" } : { commandId: context.commandId!, status: "committed", revision: "2", result: { id: "one", revision: 2 }, observedAt: "2026-01-01T00:00:00Z" }; receipts.set(receipt.commandId, receipt); if (commandMode === "unknown") throw new DomainInvocationError("Reply was lost", "unknown"); return receipt; } },
    ],
    inspectCommand: async (_context, commandId) => receipts.get(commandId),
    readSource: async (locator) => ({ locator, content: "export function updateCase() {}" }),
  };
  const harness = new FakeHarness();
  const runtime = new AiricRuntime({
    store: new MemoryRuntimeStore(), harness,
    definitions: new MemoryDefinitionSource({ assist: { manifest, documents: { "process.md": "Follow the objective.", "precedent.md": "Either order is valid." } }, reflection: { manifest: reflectionManifest, documents: { "reflection.md": "Inspect trace evidence." } } }),
  });
  runtime.registerDomain(domain);
  return { runtime, harness, domain, commandInvocations: () => commandInvocations };
}

describe("AiricRuntime", () => {
  it("delivers pinned context and commits through an Action before completing Work", async () => {
    const { runtime, harness } = fixture(); await runtime.open();
    const work = await runtime.createWork({ definitionId: "assist", objective: "Update the case", domainIds: ["cases"] });
    harness.enqueue(
      { call: { tool: "domain_case_get", input: {}, requestId: "read-1" } },
      { call: { tool: "domain_case_update", input: { value: "x" }, requestId: "write-1" } },
      { call: { tool: "airic_complete_work", input: { result: { type: "case", id: "one" } }, requestId: "complete-1" } },
      { text: "Done" },
    );
    await runtime.sendMessage(work.id, "Please do it", { id: "user", scopes: ["case:write"] });
    expect(runtime.getWork(work.id)?.status).toBe("completed");
    const trace = runtime.getTrace(work.id);
    expect(trace.map((event) => event.type)).toContain("context.delivered");
    expect(trace.map((event) => event.type)).toContain("action.prepared");
    expect(trace.map((event) => event.type)).toContain("action.committed");
    expect(harness.envelopes[0]?.instructions.map((block) => block.id)).toEqual(["process"]);
  });

  it("records selected on-demand content in the next envelope", async () => {
    const { runtime, harness } = fixture(); await runtime.open();
    const work = await runtime.createWork({ definitionId: "assist", objective: "Consider alternatives", domainIds: ["cases"] });
    harness.enqueue({ call: { tool: "airic_read_work_document", input: { id: "precedent", reason: "The customer supplied information out of order" }, requestId: "doc-1" } }, { text: "I considered both paths." });
    await runtime.sendMessage(work.id, "Continue", { id: "user", scopes: [] });
    expect(harness.envelopes[0]?.instructions.map((block) => block.id)).toEqual(["process"]);
    expect(harness.envelopes.at(-1)?.instructions.map((block) => block.id)).toEqual(["process", "precedent"]);
    expect(runtime.getTrace(work.id).some((event) => event.type === "context.retrieved")).toBe(true);
  });

  it("refuses a harness result that never confirms actual context delivery", async () => {
    const { runtime } = fixture(); await runtime.open();
    runtime.options.harness = { capabilities: () => ({ resume: false, interrupt: false, contextHook: false, compactionTrace: false }), run: async () => ({ text: "Unverified" }) };
    const work = await runtime.createWork({ definitionId: "assist", objective: "Stay governed", domainIds: ["cases"] });
    await expect(runtime.sendMessage(work.id, "Continue", { id: "user", scopes: [] })).rejects.toThrow("without confirming");
    expect(runtime.getTrace(work.id).some((event) => event.type === "message.agent")).toBe(false);
  });

  it("stores reflection candidates as content-addressed evidence, not entities", async () => {
    const { runtime } = fixture(); await runtime.open();
    const work = await runtime.createWork({ definitionId: "reflection", objective: "Reflect", domainIds: [] });
    const object = await runtime.recordReflectionCandidate(work.id, { targetKind: "operating-model", targetPath: "process.md", baseRevision: work.definition.revision, diff: "+Clarify alternate order", rationale: "Trace showed hesitation", evidenceEventIds: [] });
    expect(object.digest).toHaveLength(64);
    expect(runtime.getTrace(work.id).at(-1)?.type).toBe("reflection.candidate");
  });

  it("does not let a rejected Command satisfy Work completion", async () => {
    const { runtime, harness } = fixture("rejected"); await runtime.open();
    const work = await runtime.createWork({ definitionId: "assist", objective: "Respect the constraint", domainIds: ["cases"] });
    harness.enqueue({ call: { tool: "domain_case_update", input: {}, requestId: "rejected-1" } });
    await expect(runtime.sendMessage(work.id, "Submit", { id: "user", scopes: [] })).rejects.toThrow("More evidence is required");
    await expect(runtime.completeWork(work.id, {})).rejects.toThrow("case.update");
    expect(runtime.getTrace(work.id).some((event) => event.type === "action.rejected")).toBe(true);
  });

  it("reconciles an unknown response by stable command identity without redispatch", async () => {
    const { runtime, harness, commandInvocations } = fixture("unknown"); await runtime.open();
    const work = await runtime.createWork({ definitionId: "assist", objective: "Recover safely", domainIds: ["cases"] });
    harness.enqueue({ call: { tool: "domain_case_update", input: { value: "x" }, requestId: "stable-1" } });
    await expect(runtime.sendMessage(work.id, "Update", { id: "user", scopes: [] })).rejects.toThrow("Reply was lost");
    const actionId = runtime.getTrace(work.id).find((event) => event.type === "action.prepared")?.actionId;
    expect(actionId).toBeDefined();
    expect((await runtime.reconcileAction(actionId!, { id: "user", scopes: [] })).status).toBe("committed");
    expect(commandInvocations()).toBe(1);
  });

  it("makes a domain candidate effective only when a later Work binds the new release", async () => {
    const { runtime, domain } = fixture(); await runtime.open();
    const source = await runtime.createWork({ definitionId: "reflection", objective: "Find a domain improvement", domainIds: [] });
    const candidate = await runtime.recordReflectionCandidate(source.id, { targetKind: "domain", targetPath: "src/domain/case.ts", baseRevision: domain.sourceBundle.revision, diff: "+Document the invariant reason", rationale: "Improve Agent understanding without changing enforcement", evidenceEventIds: [] });
    runtime.registerDomain({ ...domain, release: "1.1.0", buildId: "build-2", sourceBundle: { ...domain.sourceBundle, revision: "2", digest: "source-digest-2" } });
    await runtime.recordReflectionOutcome(source.id, { candidateDigest: candidate.digest, decision: "adopted", reviewer: "architect", publishedRef: { kind: "domain-release", id: "cases", revision: "1.1.0" }, validation: { tests: "passed" } });
    expect(runtime.getWork(source.id)?.domainBindings).toEqual([]);
    const later = await runtime.createWork({ definitionId: "assist", objective: "Use the adopted domain release", domainIds: ["cases"] });
    expect(later.domainBindings[0]?.release).toBe("1.1.0");
    expect(runtime.getTrace(source.id).some((event) => event.type === "reflection.adopted")).toBe(true);
  });
});
