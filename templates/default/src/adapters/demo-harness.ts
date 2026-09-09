import type { AgentHarness, DeliveryRecord, HarnessTool } from "@airic/framework";

export class DemoHarness implements AgentHarness {
  #request = 0;
  capabilities() { return { resume: false, interrupt: true, contextHook: true, compactionTrace: false }; }

  async run(input: Parameters<AgentHarness["run"]>[0]): Promise<{ text: string; result?: unknown }> {
    const delivery: DeliveryRecord = {
      envelopeDigest: input.envelope.digest,
      adapter: { id: "transaction-demo", version: "1" },
      injectionPoints: ["rule-based-demo", "tool-registry"],
      registeredTools: input.tools.map((tool) => tool.name),
    };
    await input.onDelivered(delivery);
    if (input.envelope.workDefinition.id === "reflection") {
      const workInput = JSON.parse(input.envelope.observations.find((item) => item.id === "work")!.content) as { input: { sourceWorkId: string } };
      const readTrace = requireTool(input.tools, "airic_read_work_trace");
      const saveCandidate = requireTool(input.tools, "airic_record_reflection_candidate");
      const complete = requireTool(input.tools, "airic_complete_work");
      const events = await readTrace.invoke({ workId: workInput.input.sourceWorkId, reason: "Identify whether the operating model was delivered before domain rejection" }, this.#next()) as { eventId: string; type: string; payload: unknown }[];
      const creation = events.find((event) => event.type === "work.created")?.payload as { definition?: { revision?: string } } | undefined;
      const candidate = {
        targetKind: "operating-model",
        targetPath: "case-assistance/process.md",
        baseRevision: creation?.definition?.revision ?? "unknown",
        diff: "+ When the customer asks to submit early, name each missing fact before retrying readiness.",
        rationale: "The trace includes a domain rejection and the candidate makes the recovery guidance explicit without relaxing the invariant.",
        evidenceEventIds: events.filter((event) => event.type === "action.rejected" || event.type === "context.delivered").map((event) => event.eventId),
      } as const;
      const object = await saveCandidate.invoke(candidate, this.#next());
      await complete.invoke({ result: { type: "reflection", candidate: object, sourceWorkId: workInput.input.sourceWorkId } }, this.#next());
      return { text: "I reviewed the canonical trace and produced an operating-model candidate for human review.", result: object };
    }
    const get = requireTool(input.tools, "domain_case_get");
    const update = requireTool(input.tools, "domain_case_update");
    const complete = requireTool(input.tools, "airic_complete_work");
    const current = await get.invoke({ caseId: "demo" }, this.#next());
    const record = current as { id: string; customerName?: string; email?: string; revision: number };
    const email = input.message.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0];
    const name = input.message.match(/(?:name|customer)\s*(?:is|:|=)\s*([^,;\n]+)/i)?.[1]?.trim();
    const changes = { ...(name ? { customerName: name } : {}), ...(email ? { email } : {}) };
    if (!name && !email && !/submit|complete|ready/i.test(input.message)) {
      return { text: "I found the case. Please provide the customer name and email; you may give them together or in either order." };
    }
    try {
      const hasAllInformation = Boolean(record.customerName ?? name) && Boolean(record.email ?? email);
      const receipt = await update.invoke({ caseId: "demo", expectedRevision: record.revision, changes: { ...changes, markReady: hasAllInformation || /submit|complete|ready/i.test(input.message) } }, this.#next());
      const result = (receipt as { result?: unknown }).result;
      if (!hasAllInformation) return { text: "I saved that information. Please provide the remaining customer detail.", result };
      await complete.invoke({ result: { type: "case", record: result } }, this.#next());
      return { text: "The domain accepted the transaction and the case is ready.", result };
    } catch (error) {
      return { text: `The domain did not accept completion yet: ${error instanceof Error ? error.message : String(error)}. Please provide the missing information.` };
    }
  }

  async interrupt(): Promise<void> {}
  #next(): string { this.#request += 1; return `demo-${this.#request}`; }
}

function requireTool(tools: readonly HarnessTool[], name: string): HarnessTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Required demo tool is unavailable: ${name}`);
  return tool;
}
