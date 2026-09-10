import { createHash } from "node:crypto";
import YAML from "yaml";
import { z } from "zod";
import type { DefinitionSource } from "./ports.js";

const documentSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  title: z.string().min(1),
  role: z.enum(["process", "procedure", "policy", "precedent", "reference", "reflection"]),
  load: z.enum(["required", "on-demand"]),
  requires: z.array(z.string()).default([]),
});

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  compatibleDomains: z.array(z.object({ id: z.string(), release: z.string().optional() })).default([]),
  documents: z.array(documentSchema).min(1),
  completion: z.object({
    requiredCapabilities: z.array(z.string()).default([]),
    requiredTools: z.array(z.string()).default([]),
  }).default({ requiredCapabilities: [], requiredTools: [] }),
});

export type WorkDefinitionManifest = z.infer<typeof manifestSchema>;
export interface LoadedDocument extends z.infer<typeof documentSchema> { content: string; digest: string }
export interface WorkDefinition {
  manifest: WorkDefinitionManifest;
  digest: string;
  source: { gitHead?: string; dirty: boolean };
  required: readonly LoadedDocument[];
  discoverable: readonly Omit<LoadedDocument, "content">[];
  documents: ReadonlyMap<string, LoadedDocument>;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function loadWorkDefinition(source: DefinitionSource, definitionId: string): Promise<WorkDefinition> {
  const raw = await source.readManifest(definitionId);
  const value = typeof raw === "string" ? YAML.parse(raw) : raw;
  const manifest = manifestSchema.parse(value);
  if (manifest.id !== definitionId) throw new Error(`Definition id mismatch: expected ${definitionId}, got ${manifest.id}`);
  const ids = new Set(manifest.documents.map((doc) => doc.id));
  const paths = new Set<string>();
  for (const doc of manifest.documents) {
    if (doc.path.startsWith("/") || doc.path.split("/").includes("..")) throw new Error(`Unsafe document path: ${doc.path}`);
    if (paths.has(doc.path)) throw new Error(`Duplicate document path: ${doc.path}`);
    paths.add(doc.path);
    for (const dependency of doc.requires) if (!ids.has(dependency)) throw new Error(`Unknown document dependency: ${dependency}`);
  }
  const docs = new Map<string, LoadedDocument>();
  for (const spec of manifest.documents) {
    const content = await source.readDocument(definitionId, spec.path);
    docs.set(spec.id, { ...spec, content, digest: digest(content) });
  }
  const requiredIds = new Set(manifest.documents.filter((doc) => doc.load === "required").map((doc) => doc.id));
  const visit = (id: string) => {
    if (requiredIds.has(id)) {
      for (const dependency of docs.get(id)?.requires ?? []) if (!requiredIds.has(dependency)) { requiredIds.add(dependency); visit(dependency); }
    }
  };
  for (const id of [...requiredIds]) visit(id);
  const packageFiles = [];
  for (const path of await source.listDefinitionFiles(definitionId)) {
    const content = path === "work.yml"
      ? (typeof raw === "string" ? raw : JSON.stringify(value))
      : await source.readDocument(definitionId, path);
    packageFiles.push({ path, digest: digest(content) });
  }
  const packageDigest = digest(JSON.stringify(packageFiles.sort((a, b) => a.path.localeCompare(b.path))));
  return {
    manifest,
    digest: packageDigest,
    source: await source.status?.() ?? { dirty: false },
    required: [...requiredIds].map((id) => docs.get(id)!),
    discoverable: [...docs.values()].filter((doc) => !requiredIds.has(doc.id)).map(({ content: _content, ...doc }) => doc),
    documents: docs,
  };
}
