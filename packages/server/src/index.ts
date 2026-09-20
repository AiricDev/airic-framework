import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { type AiricRuntime, type CreateWorkInput, type LiveWorkEvent, type OperatingModelGovernancePort, type OperatingModelId, type OperatingModelRuntimePort, type TraceEvent, type TrustedCallContext, type Work, type WorkTypeRef } from "@airic/framework";

export type AiricAccessResource =
  | { kind: "work"; work: Work; action: "read" | "prompt" | "complete" | "interrupt" | "reflect" | "upload" }
  | { kind: "create"; input: CreateWorkInput }
  | { kind: "work-type"; ref: WorkTypeRef }
  | { kind: "operating-model"; target?: OperatingModelId; action: "runtime-read" | "reflection-propose" | "human-governance" }
  | { kind: "workspace" }
  | { kind: "capabilities" }
  | { kind: "upload" };

/** The application owns access policy; neither HTTP nor ACP may infer it from request bodies. */
export type AiricAccessPolicy = (actor: TrustedCallContext["actor"], resource: AiricAccessResource) => Promise<boolean> | boolean;

export interface AiricHttpHandlerOptions {
  runtime: AiricRuntime;
  basePath?: string;
  workTypes?: () => Promise<readonly { moduleId: string; workTypeId: string; title: string; digest: string }[]>;
  getWorkType?: (moduleId: string, workTypeId: string) => Promise<{ digest: string; files: Readonly<Record<string, string>> }>;
  operatingModelRuntime?: OperatingModelRuntimePort;
  operatingModelGovernance?: OperatingModelGovernancePort;
  workspaceStatus?: () => Promise<{ gitHead?: string; dirty: boolean; status: string; diff: string }>;
  saveUpload?: (input: { name: string; mediaType: string; contentBase64: string }) => Promise<{ ref: unknown }>;
  authenticate?: (request: IncomingMessage) => Promise<TrustedCallContext["actor"]>;
  authorize?: AiricAccessPolicy;
  agentConnection?: (work: Work, request: IncomingMessage) => Promise<{ url: string; cwd: string; sessionId?: string }>;
  onTraceRead?: (actor: TrustedCallContext["actor"], work: Work, channel: "http" | "sse") => Promise<void>;
  maxWorkUploadBytes?: number;
  /** Revalidate an SSE connection at this interval while authorizing every event. */
  sseAuthenticationTtlMs?: number;
}

export interface AiricServerOptions extends Omit<AiricHttpHandlerOptions, "basePath"> {
  host?: string;
  port?: number;
  staticDirectory?: string;
  basePath?: string;
}

export interface AiricHttpHandler {
  handle(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
  close(): Promise<void>;
}

export interface StaticHandlerOptions { directory: string; spaFallback?: (pathname: string) => boolean }
export interface StaticHttpHandler { handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> }

export function createStaticHandler(options: StaticHandlerOptions): StaticHttpHandler {
  const base = resolve(options.directory);
  const spaFallback = options.spaFallback ?? ((pathname) => pathname !== "/api" && !pathname.startsWith("/api/"));
  return {
    async handle(request, response) {
      if (request.method !== "GET") return false;
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      return servePath(base, decodeURIComponent(url.pathname), response, spaFallback);
    },
  };
}

export function createAiricHttpHandler(options: AiricHttpHandlerOptions): AiricHttpHandler {
  const basePath = normalizeBasePath(options.basePath ?? "/api/airic");
  const clients = new Set<{ request: IncomingMessage; response: ServerResponse; pending: Promise<void>; visibleWorkIds: Set<string> }>();
  const workClients = new Set<{ workId: string; request: IncomingMessage; response: ServerResponse; pending: Promise<void>; actor: TrustedCallContext["actor"]; authenticateAfter: number }>();
  const sseAuthenticationTtlMs = options.sseAuthenticationTtlMs ?? 10_000;
  const refreshSseActor = async (client: { request: IncomingMessage; actor: TrustedCallContext["actor"]; authenticateAfter: number }): Promise<TrustedCallContext["actor"]> => {
    if (Date.now() >= client.authenticateAfter) {
      client.actor = await authenticate(options, client.request);
      client.authenticateAfter = Date.now() + sseAuthenticationTtlMs;
    }
    return client.actor;
  };
  const writeWorkEvent = (client: { workId: string; request: IncomingMessage; response: ServerResponse; pending: Promise<void>; actor: TrustedCallContext["actor"]; authenticateAfter: number }, frame: string): void => {
    client.pending = client.pending.then(async () => {
      try {
        const actor = await refreshSseActor(client);
        const work = options.runtime.getWork(client.workId);
        if (!work || !await allowed(options, actor, { kind: "work", work, action: "read" })) { client.response.end(); workClients.delete(client); return; }
        client.response.write(frame);
      } catch { client.response.end(); workClients.delete(client); }
    });
  };
  const unsubscribe = options.runtime.subscribe((event) => {
    for (const client of clients) {
      client.pending = client.pending.then(async () => {
        try {
          const actor = await authenticate(options, client.request);
          const work = options.runtime.getWork(event.workId);
          if (!work) return;
          const readable = await allowed(options, actor, { kind: "work", work, action: "read" });
          if (!readable) { if (client.visibleWorkIds.has(work.id)) { client.response.end(); clients.delete(client); } return; }
          if (!client.visibleWorkIds.has(work.id)) { await options.onTraceRead?.(actor, work, "sse"); client.visibleWorkIds.add(work.id); }
          client.response.write(encodeSse(event));
        } catch { client.response.end(); clients.delete(client); }
      });
    }
    for (const client of workClients) if (client.workId === event.workId) writeWorkEvent(client, encodeSse(event));
  });
  const unsubscribeLive = options.runtime.subscribeLive((event) => {
    for (const client of workClients) if (client.workId === event.workId) writeWorkEvent(client, encodeLive(event));
  });
  let closed = false;
  return {
    async handle(request, response) {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) return false;
      const path = url.pathname.slice(basePath.length) || "/";
      try {
        if (closed) return json(response, 503, { error: "Airic HTTP handler is closed", code: "HandlerClosed" });
        if (path === "/health") return json(response, 200, { ok: true });
        const actor = await authenticate(options, request);
        if (path === "/events" && request.method === "GET") {
          const visible = await Promise.all(options.runtime.listWorks().map(async (work) => await allowed(options, actor, { kind: "work", work, action: "read" }) ? work : undefined));
          const readable = visible.filter((work): work is Work => Boolean(work));
          for (const work of readable) await options.onTraceRead?.(actor, work, "sse");
          const events = readable.flatMap((work) => [...options.runtime.getTrace(work.id)]).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
          response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
          const lastId = lastEventId(request, url);
          const start = typeof lastId === "string" ? Math.max(0, events.findIndex((event) => event.eventId === lastId) + 1) : events.length;
          for (const event of events.slice(start)) response.write(encodeSse(event));
          response.write(": connected\n\n"); const client = { request, response, pending: Promise.resolve(), visibleWorkIds: new Set(readable.map((work) => work.id)) }; clients.add(client); request.on("close", () => clients.delete(client)); return true;
        }
        if (path === "/works" && request.method === "GET") return json(response, 200, (await Promise.all(options.runtime.listWorks().map(async (work) => await allowed(options, actor, { kind: "work", work, action: "read" }) ? work : undefined))).filter(Boolean));
        if (path === "/works" && request.method === "POST") { const input = await bodyJson(request) as CreateWorkInput; await requireAccess(options, actor, { kind: "create", input }); return json(response, 201, await options.runtime.createWork(input, actor)); }
        if (path === "/capabilities" && request.method === "GET") { await requireAccess(options, actor, { kind: "capabilities" }); return json(response, 200, options.runtime.options.harness.capabilities()); }
        if (path === "/workspace" && request.method === "GET") { await requireAccess(options, actor, { kind: "workspace" }); return options.workspaceStatus ? json(response, 200, await options.workspaceStatus()) : json(response, 501, { error: "Workspace status is not configured", code: "NotConfigured" }); }
        if (path === "/operating-models" && request.method === "GET") { await requireAccess(options, actor, { kind: "operating-model", action: "runtime-read" }); return options.operatingModelRuntime ? json(response, 200, await options.operatingModelRuntime.listAvailableModels()) : json(response, 501, { error: "Operating Model repository is not configured", code: "NotConfigured" }); }
        const operatingModelRevisions = path.match(/^\/operating-models\/([^/]+)\/([^/]+)\/revisions$/u);
        if (operatingModelRevisions && request.method === "GET") { const target = { moduleId: decodeURIComponent(operatingModelRevisions[1]!), workTypeId: decodeURIComponent(operatingModelRevisions[2]!) }; await requireAccess(options, actor, { kind: "operating-model", target, action: "runtime-read" }); return options.operatingModelRuntime ? json(response, 200, await options.operatingModelRuntime.listRevisions(target)) : json(response, 501, { error: "Operating Model repository is not configured", code: "NotConfigured" }); }
        const operatingModelMatch = path.match(/^\/operating-models\/([^/]+)\/([^/]+)\/(active|revisions\/([^/]+))$/u);
        if (operatingModelMatch && request.method === "GET") { const target = { moduleId: decodeURIComponent(operatingModelMatch[1]!), workTypeId: decodeURIComponent(operatingModelMatch[2]!) }; await requireAccess(options, actor, { kind: "operating-model", target, action: "runtime-read" }); if (!options.operatingModelRuntime) return json(response, 501, { error: "Operating Model repository is not configured", code: "NotConfigured" }); const ref = operatingModelMatch[3] === "active" ? await options.operatingModelRuntime.resolveActive(target) : { revisionId: decodeURIComponent(operatingModelMatch[4]!), contentDigest: url.searchParams.get("contentDigest") ?? "" }; return json(response, 200, await options.operatingModelRuntime.readRevision(target, ref)); }
        if (path === "/operating-model-proposals" && request.method === "GET") { await requireAccess(options, actor, { kind: "operating-model", action: "human-governance" }); return options.operatingModelGovernance ? json(response, 200, await options.operatingModelGovernance.listProposals()) : json(response, 501, { error: "Operating Model governance is not configured", code: "NotConfigured" }); }
        if (path === "/operating-model-proposals" && request.method === "POST") { await requireAccess(options, actor, { kind: "operating-model", action: "human-governance" }); if (!options.operatingModelGovernance) return json(response, 501, { error: "Operating Model governance is not configured", code: "NotConfigured" }); const body = await bodyJson(request) as Record<string, unknown>; return json(response, 201, await options.operatingModelGovernance.propose({ ...body, proposer: { kind: "human", id: actor.id } } as never)); }
        const proposalMatch = path.match(/^\/operating-model-proposals\/([^/]+)(?:\/(review|reject|adopt))?$/u);
        if (proposalMatch && options.operatingModelGovernance) { await requireAccess(options, actor, { kind: "operating-model", action: "human-governance" }); const proposalId = decodeURIComponent(proposalMatch[1]!); if (!proposalMatch[2] && request.method === "GET") return json(response, 200, await options.operatingModelGovernance.getProposalDetail(proposalId)); if (request.method === "POST") { const body = await bodyJson(request) as Record<string, unknown>; const operation = proposalMatch[2]!; if (operation === "review") return json(response, 201, await options.operatingModelGovernance.review({ ...body, proposalId, reviewer: actor.id } as never)); if (operation === "reject") return json(response, 201, await options.operatingModelGovernance.reject({ ...body, proposalId, reviewer: actor.id } as never)); if (operation === "adopt") return json(response, 201, await options.operatingModelGovernance.adopt({ ...body, proposalId, reviewer: actor.id } as never)); } }
        const operationMatch = path.match(/^\/operating-model-operations\/([^/]+)$/u);
        if (operationMatch && request.method === "GET") { await requireAccess(options, actor, { kind: "operating-model", action: "human-governance" }); return options.operatingModelGovernance ? json(response, 200, await options.operatingModelGovernance.inspectOperation(decodeURIComponent(operationMatch[1]!))) : json(response, 501, { error: "Operating Model governance is not configured", code: "NotConfigured" }); }
        if (path === "/work-types" && request.method === "GET") { const all = await options.workTypes?.() ?? []; return json(response, 200, (await Promise.all(all.map(async (item) => await allowed(options, actor, { kind: "work-type", ref: item }) ? item : undefined))).filter(Boolean)); }
        const workTypeMatch = path.match(/^\/work-types\/([^/]+)\/([^/]+)$/u);
        if (workTypeMatch && request.method === "GET") { const ref = { moduleId: decodeURIComponent(workTypeMatch[1]!), workTypeId: decodeURIComponent(workTypeMatch[2]!) }; await requireAccess(options, actor, { kind: "work-type", ref }); return options.getWorkType ? json(response, 200, await options.getWorkType(ref.moduleId, ref.workTypeId)) : json(response, 501, { error: "WorkType reading is not configured", code: "NotConfigured" }); }
        if (path === "/uploads" && request.method === "POST") { await requireAccess(options, actor, { kind: "upload" }); return options.saveUpload ? json(response, 201, await options.saveUpload(await bodyJson(request) as never)) : json(response, 501, { error: "Uploads are not configured", code: "NotConfigured" }); }
        const match = path.match(/^\/works\/([^/]+)(?:\/(trace|messages|complete|interrupt|reflection|sources|uploads|agent-connection|events|activity))?$/u);
        if (match) {
          const workId = decodeURIComponent(match[1]!); const operation = match[2];
          const work = options.runtime.getWork(workId);
          if (!work) throw new AiricHttpError(404, "WorkNotFound", "Work not found");
          const action = operation === "messages" ? "prompt" : operation === "interrupt" ? "interrupt" : operation === "complete" ? "complete" : operation === "uploads" ? "upload" : operation === "sources" || operation?.startsWith("reflection") ? "reflect" : "read";
          await requireAccess(options, actor, { kind: "work", work, action });
          if (operation === "activity" && request.method === "GET") return json(response, 200, options.runtime.getWorkActivity?.(workId) ?? { active: false });
          if (operation === "events" && request.method === "GET") { await options.onTraceRead?.(actor, work, "sse"); response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" }); const events = options.runtime.getTrace(workId); const lastId = lastEventId(request, url); const start = typeof lastId === "string" ? Math.max(0, events.findIndex((event) => event.eventId === lastId) + 1) : events.length; for (const event of events.slice(start)) response.write(encodeSse(event)); response.write(encodeActivity(options.runtime.getWorkActivity?.(workId) ?? { active: false })); response.write(": connected\n\n"); const client = { workId, request, response, pending: Promise.resolve(), actor, authenticateAfter: Date.now() + sseAuthenticationTtlMs }; workClients.add(client); request.on("close", () => workClients.delete(client)); return true; }
          if (!operation && request.method === "GET") { await options.onTraceRead?.(actor, work, "http"); return json(response, 200, { work, trace: options.runtime.getTrace(workId) }); }
          if (operation === "trace" && request.method === "GET") { await options.onTraceRead?.(actor, work, "http"); return json(response, 200, options.runtime.getTrace(workId)); }
          if (operation === "agent-connection" && request.method === "GET") return options.agentConnection ? json(response, 200, await options.agentConnection(work, request)) : json(response, 501, { error: "ACP is not configured", code: "NotConfigured" });
          if (operation === "messages" && request.method === "POST") { const body = await bodyJson(request) as { message: string; turnContextRefs?: readonly { namespace: string; resourceType: string; resourceId: string; revision?: string; selection?: Readonly<Record<string, unknown>> }[]; evidenceDigests?: readonly string[] }; return json(response, 200, await options.runtime.sendMessage(workId, body.message, actor, body.turnContextRefs, body.evidenceDigests)); }
          if (operation === "complete" && request.method === "POST") return json(response, 200, await options.runtime.completeWork(workId, (await bodyJson(request) as { result: unknown }).result));
          if (operation === "interrupt" && request.method === "POST") { await options.runtime.interrupt(workId); return json(response, 202, { interrupted: true }); }
          if (operation === "reflection" && request.method === "POST") return json(response, 201, await options.runtime.recordReflectionCandidate(workId, await bodyJson(request) as never));
          if (operation === "sources" && request.method === "POST") { const body = await bodyJson(request) as { workId: string }; return json(response, 201, await options.runtime.attachSourceWork(workId, body.workId, actor)); }
          if (operation === "uploads" && request.method === "POST") { const body = await bodyJson(request) as { name: string; mediaType: string; contentBase64: string }; return json(response, 201, await options.runtime.attachEvidence(workId, { name: body.name, mediaType: body.mediaType, content: Buffer.from(body.contentBase64, "base64") })); }
          if (operation === "uploads" && request.method === "PUT") {
            const encodedName = request.headers["x-airic-filename"];
            if (typeof encodedName !== "string") throw new AiricHttpError(400, "InvalidFilename", "A file name is required");
            const name = decodeURIComponent(encodedName);
            if (!name || name.length > 255 || /[/\\\x00-\x1f]/u.test(name)) throw new AiricHttpError(400, "InvalidFilename", "Invalid file name");
            const mediaType = String(request.headers["content-type"] ?? "application/octet-stream").split(";")[0]!;
            const content = await readBounded(request, options.maxWorkUploadBytes ?? 25 * 1024 * 1024);
            if (!content.length) throw new AiricHttpError(400, "EmptyUpload", "The file is empty");
            return json(response, 201, await options.runtime.attachEvidence(workId, { name, mediaType, content }));
          }
        }
        return json(response, 404, { error: "Airic route not found", code: "RouteNotFound" });
      } catch (error) { return json(response, error instanceof AiricHttpError ? error.status : error instanceof SyntaxError ? 400 : error instanceof Error && error.message.startsWith("WorkBusy:") ? 409 : 400, { error: error instanceof Error ? error.message : String(error), code: error instanceof AiricHttpError ? error.code : error instanceof SyntaxError ? "InvalidJson" : error instanceof Error && error.message.startsWith("WorkBusy:") ? "WorkBusy" : "RequestFailed" }); }
    },
    async close() { if (closed) return; closed = true; unsubscribe(); unsubscribeLive(); for (const client of clients) client.response.end(); clients.clear(); for (const client of workClients) client.response.end(); workClients.clear(); },
  };
}

export function createAiricServer(options: AiricServerOptions) {
  const handler = createAiricHttpHandler({ ...options, basePath: options.basePath ?? "/api" });
  const staticHandler = options.staticDirectory ? createStaticHandler({ directory: options.staticDirectory }) : undefined;
  const server = createServer(async (request, response) => {
    if (await handler.handle(request, response)) return;
    if (staticHandler && await staticHandler.handle(request, response)) return;
    json(response, 404, { error: "Not found", code: "RouteNotFound" });
  });
  return {
    server,
    listen: () => new Promise<{ host: string; port: number }>((resolveListen, reject) => { server.once("error", reject); server.listen(options.port ?? 4173, options.host ?? "127.0.0.1", () => { server.off("error", reject); const address = server.address(); if (!address || typeof address === "string") return reject(new Error("Server did not bind a TCP address")); resolveListen({ host: address.address, port: address.port }); }); }),
    close: async () => { await handler.close(); await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())); },
  };
}

function normalizeBasePath(value: string): string { const path = `/${value}`.replace(/\/{2,}/gu, "/").replace(/\/$/u, ""); return path || "/"; }
function lastEventId(request: IncomingMessage, url: URL): string | undefined { const header = request.headers["last-event-id"]; const fromHeader = Array.isArray(header) ? header[0] : header; return fromHeader ?? url.searchParams.get("lastEventId") ?? undefined; }
export class AiricHttpError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }
async function authenticate(options: AiricHttpHandlerOptions, request: IncomingMessage): Promise<TrustedCallContext["actor"]> {
  if (!options.authenticate) throw new AiricHttpError(401, "Unauthenticated", "Authentication is required");
  try { const actor = await options.authenticate(request); if (!actor?.id) throw new Error("No trusted actor"); return actor; }
  catch { throw new AiricHttpError(401, "Unauthenticated", "Authentication is required"); }
}
async function allowed(options: AiricHttpHandlerOptions, actor: TrustedCallContext["actor"], resource: AiricAccessResource): Promise<boolean> { try { return Boolean(await options.authorize?.(actor, resource)); } catch { return false; } }
async function requireAccess(options: AiricHttpHandlerOptions, actor: TrustedCallContext["actor"], resource: AiricAccessResource): Promise<void> { if (!await allowed(options, actor, resource)) throw new AiricHttpError(403, "Forbidden", "Access denied"); }
async function readBounded(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > limit) throw new AiricHttpError(413, "UploadTooLarge", "Request exceeds the configured size limit"); chunks.push(bytes); }
  return Buffer.concat(chunks, size);
}
async function bodyJson(request: IncomingMessage): Promise<unknown> { const bytes = await readBounded(request, 1024 * 1024); return bytes.length ? JSON.parse(bytes.toString("utf8")) : {}; }
function json(response: ServerResponse, status: number, value: unknown): true { response.writeHead(status, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify(value)); return true; }
function encodeSse(event: TraceEvent): string { return `id: ${event.eventId}\nevent: trace\ndata: ${JSON.stringify(event)}\n\n`; }
function encodeLive(event: LiveWorkEvent): string { return `event: live\ndata: ${JSON.stringify(event)}\n\n`; }
function encodeActivity(activity: { active: boolean; startedAt?: string }): string { return `event: activity\ndata: ${JSON.stringify(activity)}\n\n`; }
async function servePath(base: string, pathname: string, response: ServerResponse, spaFallback: (pathname: string) => boolean): Promise<boolean> {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const path = resolve(base, requested);
  if (path !== base && !path.startsWith(`${base}${sep}`)) { json(response, 403, { error: "Forbidden", code: "Forbidden" }); return true; }
  let target = path;
  try { if ((await stat(target)).isDirectory()) target = resolve(target, "index.html"); } catch { if (!extname(requested) && spaFallback(pathname)) target = resolve(base, "index.html"); }
  try { const info = await stat(target); response.writeHead(200, { "content-type": mime(target), "content-length": info.size }); createReadStream(target).pipe(response); return true; } catch { return false; }
}
function mime(path: string): string { return ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" } as Record<string, string>)[extname(path)] ?? "application/octet-stream"; }
