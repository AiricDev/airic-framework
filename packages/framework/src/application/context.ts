import { createHash, randomUUID } from "node:crypto";
import type { Work } from "../domain/work.js";
import type { DomainModule } from "../integration/contracts.js";
import type { WorkDefinition } from "./work-definition.js";

export interface ContextBlock {
  id: string;
  title: string;
  content: string;
  digest: string;
  authority: "operating-model" | "domain" | "user" | "runtime";
}

export interface ContextProvenance {
  source: { kind: "work" | "definition" | "domain-source" | "tool"; id: string; path?: string };
  reason: "required" | "selected" | "tool-bound" | "work";
  authority: "operating-model" | "domain" | "user" | "runtime";
  versionOrDigest: string;
  renderedAs: "instruction" | "observation" | "catalog" | "tool";
}

export interface ContextEnvelope {
  envelopeId: string;
  workId: string;
  sequence: number;
  assemblerVersion: "airic-context-v1";
  workDefinition: { id: string; digest: string; gitHead?: string; dirty: boolean };
  domainBindings: Work["domainBindings"];
  instructions: readonly ContextBlock[];
  observations: readonly ContextBlock[];
  capabilityCatalog: readonly { id: string; domainId: string; kind: string; title: string; description: string; inputSchema: unknown; outputSchema: unknown }[];
  availableCapabilities: readonly string[];
  discoverableContent: readonly { id: string; title: string; path: string; role: string; digest: string }[];
  provenance: readonly ContextProvenance[];
  digest: string;
}

export function assembleContext(input: { work: Work; definition: WorkDefinition; domains: readonly DomainModule[]; sequence: number }): ContextEnvelope {
  const selected = new Set(input.work.selectedContent);
  const documents = [...input.definition.required, ...[...input.definition.documents.values()].filter((doc) => selected.has(doc.id))]
    .filter((doc, index, all) => all.findIndex((candidate) => candidate.id === doc.id) === index);
  const instructions = documents.map((doc) => ({ id: doc.id, title: doc.title, content: doc.content, digest: doc.digest, authority: "operating-model" as const }));
  const observations: ContextBlock[] = [{
    id: "work",
    title: "Current work",
    content: JSON.stringify({ objective: input.work.objective, input: input.work.input, status: input.work.status }),
    digest: hash(JSON.stringify({ objective: input.work.objective, input: input.work.input, status: input.work.status })),
    authority: "user",
  }];
  const capabilityCatalog = input.domains.flatMap((domain) => domain.capabilities.map((capability) => ({
    id: capability.id, domainId: domain.id, kind: capability.kind, title: capability.title, description: capability.description,
    inputSchema: capability.inputSchema, outputSchema: capability.outputSchema,
  })));
  const provenance: ContextProvenance[] = [
    { source: { kind: "work", id: input.work.id }, reason: "work", authority: "user", versionOrDigest: String(input.work.revision), renderedAs: "observation" },
    ...documents.map((doc) => ({ source: { kind: "definition" as const, id: input.definition.manifest.id, path: doc.path }, reason: (doc.load === "required" ? "required" : "selected") as "required" | "selected", authority: "operating-model" as const, versionOrDigest: doc.digest, renderedAs: "instruction" as const })),
    ...capabilityCatalog.map((capability) => ({ source: { kind: "tool" as const, id: capability.id }, reason: "tool-bound" as const, authority: "domain" as const, versionOrDigest: input.domains.find((domain) => domain.id === capability.domainId)!.release, renderedAs: "tool" as const })),
  ];
  const body = {
    workId: input.work.id, sequence: input.sequence,
    workDefinition: { id: input.work.definition.id, digest: input.definition.digest, ...input.definition.source },
    domainBindings: input.work.domainBindings,
    instructions, observations, capabilityCatalog, availableCapabilities: capabilityCatalog.map((item) => item.id),
    discoverableContent: input.definition.discoverable, provenance,
  };
  return { envelopeId: randomUUID(), assemblerVersion: "airic-context-v1", ...body, digest: hash(stableStringify(body)) };
}

export function renderContextEnvelope(envelope: ContextEnvelope): string {
  const instructions = envelope.instructions.map((item) => `## ${item.title}\n\n${item.content}`).join("\n\n");
  const git = envelope.workDefinition.gitHead ? `\nGit: ${envelope.workDefinition.gitHead}${envelope.workDefinition.dirty ? " (dirty)" : ""}` : "";
  return `# Airic governed work\n\nWork: ${envelope.workId}\nDefinition: ${envelope.workDefinition.id}\nDefinition digest: ${envelope.workDefinition.digest}${git}\nEnvelope: ${envelope.digest}\n\n${instructions}\n\n## Current observations\n\n${envelope.observations.map((item) => item.content).join("\n")}`;
}

export function hash(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
