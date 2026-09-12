import { describe, expect, it } from "vitest";
import { describePiBridge } from "@airic/harness-pi";
import type { ContextEnvelope, HarnessTool } from "@airic/framework";

describe("Pi bridge delivery probe", () => {
  it("exposes the rendered envelope, actual tools, hooks and pre-send payload digest", () => {
    const envelope = {
      envelopeId: "e", workId: "w", sequence: 1, assemblerVersion: "airic-context-v1", workType: { moduleId: "cases", workTypeId: "assist", operatingDigest: "d1", gitHead: "abc", dirty: false }, domainBindings: [],
      instructions: [{ id: "process", title: "Process", content: "Follow reviewed method", digest: "d", authority: "operating-model" }], observations: [], capabilityCatalog: [], availableCapabilities: [], discoverableContent: [], provenance: [], digest: "envelope-digest",
    } satisfies ContextEnvelope;
    const tools: HarnessTool[] = [{ name: "domain_case_get", description: "Get", inputSchema: { type: "object" }, invoke: async () => ({}) }];
    const probe = describePiBridge(envelope, tools, { model: "test", messages: [{ role: "system", content: "serialized" }] });
    expect(probe.systemPrompt).toContain("Follow reviewed method");
    expect(probe.delivery.registeredTools).toEqual(["domain_case_get"]);
    expect(probe.delivery.providerPayloadDigest).toHaveLength(64);
    expect(probe.hooks).toContain("before_provider_request");
  });
});
