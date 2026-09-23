import { createHash } from "node:crypto";
import YAML from "yaml";
import { z } from "zod";
import type { OperatingModelSnapshot } from "./operating-model.js";

const documentSchema = z.object({ id: z.string().min(1), path: z.string().min(1), title: z.string().min(1), role: z.enum(["process", "procedure", "policy", "precedent", "reference", "reflection"]), load: z.enum(["required", "on-demand"]), requires: z.array(z.string()).default([]) });
const manifestSchema = z.object({ schemaVersion: z.literal(1), id: z.string().min(1), title: z.string().min(1), description: z.string().default(""), capabilities: z.object({ allowed: z.array(z.string()).default([]) }).default({ allowed: [] }), extensions: z.record(z.string(), z.unknown()).default({}), documents: z.array(documentSchema).min(1), completion: z.object({ mode: z.enum(["agent", "user"]).default("agent"), requiredCapabilities: z.array(z.string()).default([]), requiredTools: z.array(z.string()).default([]) }).default({ mode: "agent", requiredCapabilities: [], requiredTools: [] }) });
export type WorkDefinitionManifest = z.infer<typeof manifestSchema>;
export interface LoadedDocument extends z.infer<typeof documentSchema> { content: string; digest: string }
export interface WorkDefinition { manifest: WorkDefinitionManifest; digest: string; source: { gitHead?: string; dirty: boolean }; required: readonly LoadedDocument[]; discoverable: readonly Omit<LoadedDocument, "content">[]; documents: ReadonlyMap<string, LoadedDocument> }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }

/** `work.yml` is parsed from the package file, never a duplicate snapshot field. */
export async function loadWorkDefinition(snapshot: OperatingModelSnapshot): Promise<WorkDefinition> {
  const workYml = snapshot.files.find((file) => file.path === "work.yml")?.content;
  if (workYml === undefined) throw new Error("Operating Model revision is missing work.yml");
  const manifest = manifestSchema.parse(YAML.parse(workYml));
  if (manifest.id !== snapshot.target.workTypeId) throw new Error(`WorkType id mismatch: expected ${snapshot.target.workTypeId}, got ${manifest.id}`);
  const allowed = new Set(manifest.capabilities.allowed); const undeclared = manifest.completion.requiredCapabilities.filter((id) => !allowed.has(id));
  if (undeclared.length) throw new Error(`Completion capabilities must be allowed by the Work Definition: ${undeclared.join(", ")}`);
  const ids = new Set(manifest.documents.map((doc) => doc.id)); const paths = new Set<string>();
  for (const doc of manifest.documents) { if (doc.path.startsWith("/") || doc.path.split("/").includes("..")) throw new Error(`Unsafe document path: ${doc.path}`); if (paths.has(doc.path)) throw new Error(`Duplicate document path: ${doc.path}`); paths.add(doc.path); for (const required of doc.requires) if (!ids.has(required)) throw new Error(`Unknown document dependency: ${required}`); }
  const docs = new Map<string, LoadedDocument>();
  for (const spec of manifest.documents) { const content = snapshot.files.find((file) => file.path === spec.path)?.content; if (content === undefined) throw new Error(`Operating Model revision is missing document ${spec.path}`); docs.set(spec.id, { ...spec, content, digest: digest(content) }); }
  const requiredIds = new Set(manifest.documents.filter((doc) => doc.load === "required").map((doc) => doc.id));
  const visit = (id: string) => { if (requiredIds.has(id)) for (const dependency of docs.get(id)?.requires ?? []) if (!requiredIds.has(dependency)) { requiredIds.add(dependency); visit(dependency); } };
  for (const id of [...requiredIds]) visit(id);
  const packageDigest = digest(JSON.stringify(snapshot.files.map((file) => ({ path: file.path, digest: digest(file.content) })).sort((a, b) => a.path.localeCompare(b.path))));
  return { manifest, digest: packageDigest, source: { ...(snapshot.sourceRef ? { gitHead: snapshot.sourceRef } : {}), dirty: false }, required: [...requiredIds].map((id) => docs.get(id)!), discoverable: [...docs.values()].filter((doc) => !requiredIds.has(doc.id)).map(({ content: _content, ...doc }) => doc), documents: docs };
}
