import { createHash } from "node:crypto";
import { DomainInvocationError, type CapabilityBinding, type CommandInspection, type DomainProvider, type JsonSchema, type SourceLocator, type TrustedCallContext } from "./contracts.js";

/**
 * Provider adapter for an `airic-domain/v1` HTTP service.  The framework
 * still sees the normal domain port; authentication and provider details stay
 * at the composition root.
 */
export interface HttpDomainProviderOptions {
  baseUrl: string;
  moduleId: string;
  headers?: Readonly<Record<string, string>>;
  /**
   * Composition-root owned transport authentication.  This deliberately sees
   * only the already-serialized request, never model prompts or tool state.
   */
  requestHeaders?(request: {
    kind: "manifest" | "query" | "command" | "inspection";
    method: "GET" | "POST";
    path: string;
    body?: string;
    context?: TrustedCallContext;
  }): Promise<Readonly<Record<string, string>>> | Readonly<Record<string, string>>;
  fetch?: typeof globalThis.fetch;
}

type Manifest = {
  protocolVersion: "airic-domain/v1";
  domain: { id: string; release: string; buildId?: string; digest?: string; readme?: SourceLocator };
  capabilities: readonly { id: string; title: string; description: string; kind: "query" | "compute" | "command"; inputSchema: JsonSchema; outputSchema: JsonSchema }[];
};

export async function createHttpDomainProvider(options: HttpDomainProviderOptions): Promise<DomainProvider> {
  const request = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.replace(/\/$/u, "");
  const headersFor = async (kind: "manifest" | "query" | "command" | "inspection", method: "GET" | "POST", path: string, body?: string, context?: TrustedCallContext) => ({
    ...options.headers,
    ...await options.requestHeaders?.({ kind, method, path, ...(body === undefined ? {} : { body }), ...(context === undefined ? {} : { context }) }),
  });
  const manifestPath = "/airic/v1/manifest";
  let response: Response;
  try { response = await request(`${baseUrl}${manifestPath}`, { headers: await headersFor("manifest", "GET", manifestPath) }); }
  catch (error) { throw new DomainInvocationError(`Remote domain manifest is unavailable: ${String(error)}`, "unknown"); }
  if (!response.ok) throw new Error(`Remote domain manifest failed: ${response.status}`);
  let manifest: Manifest;
  try { manifest = await response.json() as Manifest; }
  catch { throw new Error("Remote domain manifest is not valid JSON"); }
  validateManifest(manifest);
  const digest = manifest.domain.digest ?? createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  const invoke = async (capability: Manifest["capabilities"][number], context: TrustedCallContext, input: unknown): Promise<unknown> => {
    const route = capability.kind === "command" ? "commands" : "queries";
    const path = `/airic/v1/${route}/${encodeURIComponent(capability.id)}`;
    const bodyText = JSON.stringify({ workId: context.workId, actionId: context.actionId, commandId: context.commandId, expectedDomainRelease: context.expectedDomainRelease, targetRevision: context.targetRevision, input });
    let result: Response;
    try {
      result = await request(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", ...await headersFor(capability.kind === "command" ? "command" : "query", "POST", path, bodyText, context) }, body: bodyText });
    } catch (error) { throw new DomainInvocationError(`Remote domain request outcome is unknown: ${String(error)}`, "unknown"); }
    let body: unknown;
    try { body = await result.json() as unknown; }
    catch { throw new DomainInvocationError("Remote domain response could not be parsed", "unknown"); }
    if (!result.ok) throw new DomainInvocationError(`Remote domain invocation failed: ${result.status}`, "not-applied", "RemoteDomainRejected", body);
    if (capability.kind === "command") validateCommandReceipt(body);
    if (isUnknownReceipt(body)) throw new DomainInvocationError("Remote command outcome is unknown", "unknown", "RemoteCommandUnknown", body);
    return body;
  };
  const capabilities: CapabilityBinding[] = manifest.capabilities.map((capability) => ({
    ...capability,
    source: { path: `airic-domain/${capability.id}`, digest },
    invoke: async (context, input) => invoke(capability, context, input),
  }));
  return {
    id: manifest.domain.id,
    moduleId: options.moduleId,
    release: manifest.domain.release,
    buildId: manifest.domain.buildId ?? digest.slice(0, 16),
    sourceBundle: { id: manifest.domain.id, revision: manifest.domain.release, digest },
    readme: manifest.domain.readme ?? { path: "airic-domain/manifest", digest },
    capabilities,
    inspectCommand: async (_context, commandId): Promise<CommandInspection | undefined> => {
      const path = `/airic/v1/commands/${encodeURIComponent(commandId)}`;
      let result: Response;
      try { result = await request(`${baseUrl}${path}`, { headers: await headersFor("inspection", "GET", path, undefined, _context) }); }
      catch (error) { throw new DomainInvocationError(`Remote command inspection outcome is unknown: ${String(error)}`, "unknown"); }
      if (result.status === 404) return undefined;
      if (!result.ok) throw new DomainInvocationError(`Remote command inspection failed: ${result.status}`, "not-applied");
      try {
        const inspection = await result.json() as unknown;
        validateCommandReceipt(inspection);
        return inspection as CommandInspection;
      } catch (error) {
        if (error instanceof DomainInvocationError) throw error;
        throw new DomainInvocationError("Remote command inspection response could not be parsed", "unknown");
      }
    },
  };
}

function validateManifest(manifest: Manifest): void {
  if (!manifest || manifest.protocolVersion !== "airic-domain/v1" || !manifest.domain?.id || !manifest.domain.release || !Array.isArray(manifest.capabilities)) throw new Error("Remote domain manifest has an invalid structure");
  for (const capability of manifest.capabilities) {
    if (!capability.id || !capability.title || !capability.description || !["query", "compute", "command"].includes(capability.kind) || !isObject(capability.inputSchema) || !isObject(capability.outputSchema)) throw new Error("Remote domain manifest has an invalid capability");
  }
}
function validateCommandReceipt(value: unknown): void {
  if (!isObject(value) || typeof value.commandId !== "string" || !["committed", "pending", "rejected", "unknown"].includes(String(value.status))) throw new DomainInvocationError("Remote command receipt has an invalid structure", "unknown");
}
function isUnknownReceipt(value: unknown): boolean { return isObject(value) && value.status === "unknown"; }
function isObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
