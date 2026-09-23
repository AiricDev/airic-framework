import { describe, expect, it } from "vitest";
import { AiricRuntime, DomainInvocationError, ModuleRegistry, type CommandInspection, type DomainProvider } from "@airic/framework";
import { FakeHarness, MemoryModuleSource, MemoryOperatingModelRepository, MemoryRuntimeStore } from "@airic/testing";
const creator = { id: "user", scopes: [] };

const manifest = {
  schemaVersion: 1,
  id: "assist",
  title: "Assist",

  capabilities: { allowed: ["case.get", "case.update"] },
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

  capabilities: { allowed: [] },
  documents: [{ id: "method", path: "reflection.md", title: "Method", role: "reflection", load: "required", requires: [] }],
  completion: { requiredCapabilities: [] },
} as const;

const userCompletedManifest = {
  ...manifest,
  completion: {
    mode: "user",
    requiredCapabilities: [],
  },
} as const;

function fixture(
  commandMode: "committed" | "rejected" | "unknown" = "committed",
  workManifest: unknown = manifest,
) {
  const receipts = new Map<string, CommandInspection>();
  let commandInvocations = 0;
  const domain: DomainProvider = {
    id: "cases", moduleId: "cases", release: "1.0.0", buildId: "build-1",
    sourceBundle: { id: "case-source", revision: "1", digest: "source-digest" }, readme: { path: "case.ts" },
    capabilities: [
      { id: "case.get", title: "Get", description: "Get case", kind: "query", source: { path: "case.ts" }, inputSchema: { type: "object" }, outputSchema: { type: "object" }, invoke: async () => ({ id: "one", revision: 1 }) },
      { id: "case.update", title: "Update", description: "Update case", kind: "command", source: { path: "case.ts" }, inputSchema: { type: "object" }, outputSchema: { type: "object" }, invoke: async (context) => { commandInvocations += 1; const receipt: CommandInspection = commandMode === "rejected" ? { commandId: context.commandId!, status: "rejected", error: { code: "RequiredInformationMissing", message: "More evidence is required" }, observedAt: "2026-01-01T00:00:00Z" } : { commandId: context.commandId!, status: "committed", revision: "2", result: { id: "one", revision: 2 }, observedAt: "2026-01-01T00:00:00Z" }; receipts.set(receipt.commandId, receipt); if (commandMode === "unknown") throw new DomainInvocationError("Reply was lost", "unknown"); return receipt; } },
    ],
    inspectCommand: async (_context, commandId) => receipts.get(commandId),
    readSource: async (locator) => ({ locator, content: "export function updateCase() {}" }),
  };
  const harness = new FakeHarness();
  const moduleManifests = {
    cases: { schemaVersion: 1 as const, id: "cases", title: "Cases", domain: { release: "1.0.0", exports: { capabilities: ["case.get", "case.update"], schemas: [], references: [] } }, workTypes: [{ id: "assist", path: "operating/assist" }] },
    development: { schemaVersion: 1 as const, id: "development", title: "Development", workTypes: [{ id: "reflection", path: "operating/reflection" }] },
  };
  const definitions = new MemoryModuleSource(
    Object.fromEntries(Object.entries(moduleManifests).map(([id, value]) => [id, { manifest: value }])),
    { "cases/assist": { manifest: structuredClone(workManifest), documents: { "process.md": "Follow the objective.", "precedent.md": "Either order is valid." } }, "development/reflection": { manifest: structuredClone(reflectionManifest), documents: { "reflection.md": "Inspect trace evidence." } } },
  );
  const modules = new ModuleRegistry(definitions);
  modules.registerManifest(moduleManifests.cases);
  modules.registerManifest(moduleManifests.development);
  modules.registerDomain(domain);
  const operatingModels = new MemoryOperatingModelRepository(definitions.definitions);
  const runtime = new AiricRuntime({
    store: new MemoryRuntimeStore(), harness,
    modules, operatingModels, operatingModelAuthoring: operatingModels,
    operatingModelAuthoringWorkTypes: { reflection: [{ moduleId: "development", workTypeId: "reflection" }], smith: [] },
  });
  return { runtime, harness, definitions, domain, modules, operatingModels, commandInvocations: () => commandInvocations };
}

describe("AiricRuntime", () => {
  it("keeps user-completed Work open across turns without exposing agent completion", async () => {
    const { runtime, harness } = fixture("committed", userCompletedManifest);
    await runtime.open();
    const work = await runtime.createWork(
      { moduleId: "cases", workTypeId: "assist", objective: "Ongoing session" },
      creator,
    );
    harness.enqueue({ text: "First turn" }, { text: "Second turn" });

    await runtime.sendMessage(work.id, "Begin", creator);
    await runtime.sendMessage(work.id, "Continue", creator);

    expect(runtime.getWork(work.id)?.status).toBe("open");
    expect(harness.calls.map((call) => call.workId)).toEqual([work.id, work.id]);
    expect(harness.delivered.flatMap((delivery) => delivery.registeredTools))
      .not.toContain("airic_complete_work");
    await runtime.completeWork(work.id, { closedBy: "user" });
    expect(runtime.getWork(work.id)?.status).toBe("completed");
  });

  it("binds Reflection trajectories append-only and rechecks access before each trace read", async () => {
    const { runtime, harness } = fixture(); await runtime.open();
    const source = await runtime.createWork({ moduleId: "cases", workTypeId: "assist", objective: "Source" }, creator);
    const reflection = await runtime.createWork({ moduleId: "development", workTypeId: "reflection", objective: "Reflect", sourceWorks: [{ workId: source.id }] }, creator);
    expect(reflection.sourceWorks).toEqual([{ workId: source.id }]);
    await expect(runtime.attachSourceWork(reflection.id, source.id, creator)).rejects.toThrow("Duplicate");
    await expect(runtime.attachSourceWork(reflection.id, reflection.id, creator)).rejects.toThrow("Duplicate or self");
    harness.enqueue({ call: { tool: "airic_read_work_trace", input: { workId: source.id, reason: "Inspect outcome" }, requestId: "trace" } });
    await runtime.sendMessage(reflection.id, "Read source", creator);
    expect(runtime.getTrace(reflection.id).some((event) => event.type === "context.retrieved" && (event.payload as { source?: string }).source === "trace")).toBe(true);
  });

  it("keeps host-extracted evidence Work-bound and exposes only requested blocks", async () => {
    const { runtime, harness } = fixture(); await runtime.open();
    runtime.options.extractEvidence = async () => ({ blocks: [{ locator: "page:1:part:1", text: "Equipment details" }], warnings: ["Images were not read"] });
    const work = await runtime.createWork({ moduleId: "cases", workTypeId: "assist", objective: "Inspect evidence" }, creator);
    const another = await runtime.createWork({ moduleId: "cases", workTypeId: "assist", objective: "Other" }, creator);
    const uploaded = await runtime.attachEvidence(work.id, { name: "equipment.pdf", mediaType: "application/pdf", content: new Uint8Array([1, 2, 3]) });
    expect(uploaded.extraction?.blocks).toBe(1);
    harness.enqueue(
      { call: { tool: "airic_list_work_evidence", input: { digest: uploaded.digest }, requestId: "list" } },
      { call: { tool: "airic_read_work_evidence", input: { digest: uploaded.digest, locator: "page:1:part:1", reason: "Review equipment" }, requestId: "read" } },
    );
    const result = await runtime.sendMessage(work.id, "Review the document", creator);
    expect(result.result).toMatchObject({ text: "Equipment details", warnings: ["Images were not read"] });
    expect(runtime.getTrace(work.id).some((event) => event.type === "context.retrieved" && (event.payload as { source?: string }).source === "work-evidence")).toBe(true);
    harness.enqueue({ call: { tool: "airic_read_work_evidence", input: { digest: uploaded.digest, locator: "page:1:part:1", reason: "Cross Work" }, requestId: "denied" } });
    await expect(runtime.sendMessage(another.id, "Try to read", creator)).rejects.toThrow("No readable extraction for this Work evidence");
  });
  it("scopes evidence reads to the documents selected for the current message", async () => {
    const { runtime, harness } = fixture(); await runtime.open();
    runtime.options.extractEvidence = async (input) => ({ blocks: [{ locator: "page:1", text: input.name }], warnings: [] });
    const work = await runtime.createWork({ moduleId: "cases", workTypeId: "assist", objective: "Scoped evidence" }, creator);
    const first = await runtime.attachEvidence(work.id, { name: "first.txt", mediaType: "text/plain", content: new Uint8Array([1]) });
    const second = await runtime.attachEvidence(work.id, { name: "second.txt", mediaType: "text/plain", content: new Uint8Array([2]) });
    harness.enqueue({ call: { tool: "airic_list_work_evidence", input: {}, requestId: "list" } });
    const result = await runtime.sendMessage(work.id, "Read only the selected attachment", creator, undefined, [second.digest]);
    expect(result.result).toEqual([{ name: "second.txt", mediaType: "text/plain", digest: second.digest, size: 1, blocks: 1, warnings: [] }]);
    harness.enqueue({ call: { tool: "airic_read_work_evidence", input: { digest: first.digest, locator: "page:1", reason: "Try old attachment" }, requestId: "denied" } });
    await expect(runtime.sendMessage(work.id, "Do not read the old attachment", creator, undefined, [])).rejects.toThrow("No readable extraction");
    expect(runtime.getTrace(work.id).findLast((event) => event.type === "message.user")?.payload).toMatchObject({ evidenceDigests: [] });
  });

  it("persists creator identity, serializes turns and rechecks authority before tool execution", async () => {
    const { runtime, harness } = fixture(); await runtime.open();
    let authorized = true;
    runtime.options.authorizeWork = async () => authorized;
    const work = await runtime.createWork({ moduleId: "cases", workTypeId: "assist", objective: "Govern access" }, creator);
    expect(work.createdBy).toBe("user");
    let release!: () => void;
    runtime.options.harness = { capabilities: () => harness.capabilities(), run: async (input) => {
      await input.onDelivered({ envelopeDigest: input.envelope.digest, adapter: { id: "fake", version: "1" }, injectionPoints: [], registeredTools: input.tools.map((tool) => tool.name) });
      await new Promise<void>((resolveWait) => { release = resolveWait; });
      authorized = false;
      await expect(input.tools.find((tool) => tool.name === "domain_case_update")!.invoke({}, "write")).rejects.toThrow("WorkAccessDenied");
      return { text: "Access revoked" };
    } };
    const running = runtime.sendMessage(work.id, "Start", creator);
    while (!release) await new Promise((resolveWait) => setTimeout(resolveWait, 0));
    await expect(runtime.sendMessage(work.id, "Concurrent", creator)).rejects.toThrow("WorkBusy");
    release(); await running;
    expect(runtime.getTrace(work.id).filter((event) => event.type === "message.user")).toHaveLength(1);
  });
  it("delivers current operating-model context and commits through an Action before completing Work", async () => {
    const { runtime, harness } = fixture(); await runtime.open();
    const work = await runtime.createWork({ moduleId: "cases", workTypeId: "assist", objective: "Update the case" }, creator);
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

  it("exposes only capabilities explicitly allowed by the Work Definition", async () => {
    const { runtime, harness, definitions } = fixture();
    (definitions.definitions["cases/assist"]!.manifest as { capabilities: { allowed: string[] }; completion: { requiredCapabilities: string[] } }).capabilities.allowed = ["case.get"];
    (definitions.definitions["cases/assist"]!.manifest as { completion: { requiredCapabilities: string[] } }).completion.requiredCapabilities = [];
    await runtime.open();
    const work = await runtime.createWork({ moduleId: "cases", workTypeId: "assist", objective: "Read without writing" }, creator);
    harness.enqueue({ text: "Read only" });
    await runtime.sendMessage(work.id, "Inspect", { id: "user", scopes: [] });
    expect(harness.envelopes[0]?.availableCapabilities).toEqual(["case.get"]);
    expect(harness.delivered[0]?.registeredTools).toContain("domain_case_get");
    expect(harness.delivered[0]?.registeredTools).not.toContain("domain_case_update");
  });

  it("rejects completion requirements outside the capability allowlist", async () => {
    const { runtime, definitions } = fixture();
    (definitions.definitions["cases/assist"]!.manifest as { capabilities: { allowed: string[] } }).capabilities.allowed = ["case.get"];
    await runtime.open();
    await expect(runtime.createWork({ moduleId: "cases", workTypeId: "assist", objective: "Invalid definition" }, creator)).rejects.toThrow("must be allowed");
  });

  it("records selected on-demand content in the next envelope", async () => {
    const { runtime, harness } = fixture(); await runtime.open();
    const work = await runtime.createWork({ moduleId: "cases", workTypeId: "assist", objective: "Consider alternatives" }, creator);
    harness.enqueue({ call: { tool: "airic_read_work_document", input: { id: "precedent", reason: "The customer supplied information out of order" }, requestId: "doc-1" } }, { text: "I considered both paths." });
    await runtime.sendMessage(work.id, "Continue", { id: "user", scopes: [] });
    expect(harness.envelopes[0]?.instructions.map((block) => block.id)).toEqual(["process"]);
    expect(harness.envelopes.at(-1)?.instructions.map((block) => block.id)).toEqual(["process", "precedent"]);
    expect(runtime.getTrace(work.id).some((event) => event.type === "context.retrieved")).toBe(true);
  });

  it("reloads an adopted operating model for the next turn and preserves delivered content as evidence", async () => {
    const { runtime, harness, operatingModels } = fixture(); await runtime.open();
    const work = await runtime.createWork({ moduleId: "cases", workTypeId: "assist", objective: "Follow live guidance" }, creator);
    harness.enqueue({ text: "First" });
    await runtime.sendMessage(work.id, "Begin", { id: "user", scopes: [] });
    await operatingModels.replaceActiveForTest({ moduleId: "cases", workTypeId: "assist" }, { "process.md": "Follow the revised objective." });
    harness.enqueue({ text: "Second" });
    await runtime.sendMessage(work.id, "Continue", { id: "user", scopes: [] });
    expect(harness.envelopes.at(-1)?.instructions[0]?.content).toBe("Follow the revised objective.");
    const trace = runtime.getTrace(work.id);
    expect(trace.some((event) => event.type === "context.operating-model-changed")).toBe(true);
    const assembled = trace.filter((event) => event.type === "context.assembled");
    expect((assembled[0]?.payload as { evidence?: unknown[] }).evidence).toHaveLength(1);
    expect((assembled[1]?.payload as { evidence?: unknown[] }).evidence).toHaveLength(1);
  });

  it("refuses a harness result that never confirms actual context delivery", async () => {
    const { runtime } = fixture(); await runtime.open();
    runtime.options.harness = { capabilities: () => ({ resume: false, interrupt: false, contextHook: false, compactionTrace: false }), run: async () => ({ text: "Unverified" }) };
    const work = await runtime.createWork({ moduleId: "cases", workTypeId: "assist", objective: "Stay governed" }, creator);
    await expect(runtime.sendMessage(work.id, "Continue", { id: "user", scopes: [] })).rejects.toThrow("without confirming");
    expect(runtime.getTrace(work.id).some((event) => event.type === "message.agent")).toBe(false);
  });

  it("submits reflection candidates to the learning port and traces only the proposal linkage", async () => {
    const { runtime } = fixture(); await runtime.open();
    const work = await runtime.createWork({ moduleId: "development", workTypeId: "reflection", objective: "Reflect" }, creator);
    const definition = await runtime.loadDefinition("development", "reflection");
    const object = await runtime.recordReflectionCandidate(work.id, { targetKind: "operating-model", targetPath: "process.md", target: { moduleId: "cases", workTypeId: "assist" }, baseContentDigest: definition.digest, diff: "+Clarify alternate order", rationale: "Trace showed hesitation", evidenceEventIds: [] });
    expect(object.candidateDigest).toHaveLength(64);
    expect(runtime.getTrace(work.id).at(-1)?.type).toBe("reflection.proposed");
  });

  it("does not let a rejected Command satisfy Work completion", async () => {
    const { runtime, harness } = fixture("rejected"); await runtime.open();
    const work = await runtime.createWork({ moduleId: "cases", workTypeId: "assist", objective: "Respect the constraint" }, creator);
    harness.enqueue({ call: { tool: "domain_case_update", input: {}, requestId: "rejected-1" } });
    await expect(runtime.sendMessage(work.id, "Submit", { id: "user", scopes: [] })).rejects.toThrow("More evidence is required");
    await expect(runtime.completeWork(work.id, {})).rejects.toThrow("case.update");
    expect(runtime.getTrace(work.id).some((event) => event.type === "action.rejected")).toBe(true);
  });

  it("requires successful harness tool evidence declared by the current operating model", async () => {
    const { runtime, harness, definitions } = fixture();
    (definitions.definitions["cases/assist"]!.manifest as { completion: { requiredCapabilities: string[]; requiredTools?: string[] } }).completion = { requiredCapabilities: [], requiredTools: ["workspace_changes"] };
    await runtime.open();
    const work = await runtime.createWork({ moduleId: "cases", workTypeId: "assist", objective: "Produce governed files" }, creator);
    await expect(runtime.completeWork(work.id, {})).rejects.toThrow("workspace_changes");
    harness.enqueue(
      { event: { type: "tool", payload: { phase: "end", name: "workspace_changes", isError: false, result: { changes: [] } } } },
      { call: { tool: "airic_complete_work", input: { result: { type: "workspace-change" } }, requestId: "complete-with-empty-evidence" } },
    );
    await expect(runtime.sendMessage(work.id, "Finish without changes", { id: "user", scopes: [] })).rejects.toThrow("workspace_changes");
    harness.enqueue(
      { event: { type: "tool", payload: { phase: "end", name: "workspace_changes", isError: false, result: { changes: [{ path: "src/domain/case.ts", status: "modified" }], changeSetDigest: "same-change-set" } } } },
      { call: { tool: "airic_complete_work", input: { result: { type: "workspace-change" } }, requestId: "complete-tools" } },
    );
    await runtime.sendMessage(work.id, "Finish", { id: "user", scopes: [] });
    expect(runtime.getWork(work.id)?.status).toBe("completed");
  });

  it("requires structured passed evidence from host checks", async () => {
    const { runtime, harness, definitions } = fixture();
    (definitions.definitions["cases/assist"]!.manifest as { completion: { requiredCapabilities: string[]; requiredTools?: string[] } }).completion = { requiredCapabilities: [], requiredTools: ["workspace_check_domain_tests"] };
    await runtime.open();
    const work = await runtime.createWork({ moduleId: "cases", workTypeId: "assist", objective: "Validate governed files" }, creator);
    harness.enqueue(
      { event: { type: "tool", payload: { phase: "end", name: "workspace_check_domain_tests", isError: false } } },
      { call: { tool: "airic_complete_work", input: { result: {} }, requestId: "missing-check-evidence" } },
    );
    await expect(runtime.sendMessage(work.id, "Finish without evidence", { id: "user", scopes: [] })).rejects.toThrow("workspace_check_domain_tests");
    harness.enqueue(
      { event: { type: "tool", payload: { phase: "end", name: "workspace_check_domain_tests", isError: false, result: { check: { status: "passed" }, changeSetDigest: "same-change-set" } } } },
      { call: { tool: "airic_complete_work", input: { result: {} }, requestId: "with-check-evidence" } },
    );
    await runtime.sendMessage(work.id, "Finish with evidence", { id: "user", scopes: [] });
    expect(runtime.getWork(work.id)?.status).toBe("completed");
  });

  it("keeps successful workspace evidence across unchanged context refreshes", async () => {
    const { runtime, harness, definitions } = fixture();
    (definitions.definitions["cases/assist"]!.manifest as { completion: { requiredCapabilities: string[]; requiredTools?: string[] } }).completion = { requiredCapabilities: [], requiredTools: ["workspace_check_domain_tests", "workspace_changes"] };
    await runtime.open();
    const work = await runtime.createWork({ moduleId: "cases", workTypeId: "assist", objective: "Validate governed files" }, creator);
    harness.enqueue(
      { event: { type: "tool", payload: { phase: "end", name: "workspace_check_domain_tests", isError: false, result: { check: { status: "passed" }, changeSetDigest: "current-files" } } } },
      { event: { type: "tool", payload: { phase: "end", name: "workspace_changes", isError: false, result: { changes: [{ path: "src/domain/case.ts", status: "modified" }], changeSetDigest: "current-files" } } } },
    );
    await runtime.sendMessage(work.id, "Validate", { id: "user", scopes: [] });
    harness.enqueue({ call: { tool: "airic_complete_work", input: { result: {} }, requestId: "complete-after-refresh" } });
    await runtime.sendMessage(work.id, "Complete", { id: "user", scopes: [] });
    expect(runtime.getWork(work.id)?.status).toBe("completed");
  });

  it("does not reuse a check from an older workspace change set", async () => {
    const { runtime, harness, definitions } = fixture();
    (definitions.definitions["cases/assist"]!.manifest as { completion: { requiredCapabilities: string[]; requiredTools?: string[] } }).completion = { requiredCapabilities: [], requiredTools: ["workspace_check_domain_tests", "workspace_changes"] };
    await runtime.open();
    const work = await runtime.createWork({ moduleId: "cases", workTypeId: "assist", objective: "Validate latest files" }, creator);
    harness.enqueue(
      { event: { type: "tool", payload: { phase: "end", name: "workspace_check_domain_tests", isError: false, result: { check: { status: "passed" }, changeSetDigest: "old-files" } } } },
      { event: { type: "tool", payload: { phase: "end", name: "workspace_changes", isError: false, result: { changes: [{ path: "src/domain/case.ts" }], changeSetDigest: "new-files" } } } },
      { call: { tool: "airic_complete_work", input: { result: {} }, requestId: "stale-check" } },
    );
    await expect(runtime.sendMessage(work.id, "Finish", { id: "user", scopes: [] })).rejects.toThrow("workspace_check_domain_tests");
  });

  it("reconciles an unknown response by stable command identity without redispatch", async () => {
    const { runtime, harness, commandInvocations } = fixture("unknown"); await runtime.open();
    const work = await runtime.createWork({ moduleId: "cases", workTypeId: "assist", objective: "Recover safely" }, creator);
    harness.enqueue({ call: { tool: "domain_case_update", input: { value: "x" }, requestId: "stable-1" } });
    await expect(runtime.sendMessage(work.id, "Update", { id: "user", scopes: [] })).rejects.toThrow("Reply was lost");
    const actionId = runtime.getTrace(work.id).find((event) => event.type === "action.prepared")?.actionId;
    expect(actionId).toBeDefined();
    expect((await runtime.reconcileAction(actionId!, { id: "user", scopes: [] })).status).toBe("committed");
    expect(commandInvocations()).toBe(1);
  });

  it("fails closed when a bound Domain build changes", async () => {
    const { runtime, domain, harness } = fixture(); await runtime.open();
    const source = await runtime.createWork({ moduleId: "development", workTypeId: "reflection", objective: "Find a domain improvement" }, creator);
    const candidate = await runtime.recordReflectionCandidate(source.id, { targetKind: "operating-model", targetPath: "process.md", target: { moduleId: "cases", workTypeId: "assist" }, baseContentDigest: domain.sourceBundle.digest, diff: "+Document the invariant reason", rationale: "Improve Agent guidance", evidenceEventIds: [] });
    expect(candidate.candidateDigest).toHaveLength(64);
    expect(runtime.getWork(source.id)?.domainBindings).toEqual([]);
    const bound = await runtime.createWork({ moduleId: "cases", workTypeId: "assist", objective: "Use the bound release" }, creator);
    (domain as { buildId: string }).buildId = "build-2";
    harness.enqueue({ call: { tool: "domain_case_get", input: {}, requestId: "read-after-build-change" } });
    await expect(runtime.sendMessage(bound.id, "Read", { id: "user", scopes: [] })).rejects.toThrow("BindingChanged");
    expect(runtime.getTrace(source.id).some((event) => event.type === "reflection.proposed")).toBe(true);
  });

  it("reports turn activity and traces the turn lifecycle", async () => {
    const { runtime } = fixture(); await runtime.open();
    const work = await runtime.createWork({ moduleId: "cases", workTypeId: "assist", objective: "Observe activity" }, creator);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = runtime.options.harness;
    runtime.options.harness = { capabilities: () => original.capabilities(), run: async (input: Parameters<typeof original.run>[0]) => { await gate; return original.run(input); } };
    const pending = runtime.sendMessage(work.id, "Start", { id: "user", scopes: [] });
    for (let index = 0; index < 200 && !runtime.getWorkActivity(work.id).active; index += 1) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(runtime.getWorkActivity(work.id)).toMatchObject({ active: true });
    expect(runtime.getTrace(work.id).some((event) => event.type === "turn.started")).toBe(true);
    await expect(runtime.completeWork(work.id, {})).rejects.toThrow(`WorkBusy: ${work.id}`);
    release();
    await pending;
    expect(runtime.getWorkActivity(work.id)).toEqual({ active: false });
    expect(runtime.getTrace(work.id).some((event) => event.type === "turn.completed")).toBe(true);
  });

  it("traces a failed turn and releases the activity lock", async () => {
    const { runtime } = fixture(); await runtime.open();
    const work = await runtime.createWork({ moduleId: "cases", workTypeId: "assist", objective: "Fail safely" }, creator);
    runtime.options.harness = { capabilities: () => ({ resume: false, interrupt: false, contextHook: false, compactionTrace: false }), run: async () => { throw new Error("Harness exploded"); } };
    await expect(runtime.sendMessage(work.id, "Fail", { id: "user", scopes: [] })).rejects.toThrow("Harness exploded");
    expect(runtime.getTrace(work.id).some((event) => event.type === "turn.failed")).toBe(true);
    expect(runtime.getWorkActivity(work.id)).toEqual({ active: false });
  });
});
