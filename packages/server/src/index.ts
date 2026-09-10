import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import type { AiricRuntime, TraceEvent, TrustedCallContext } from "@airic/framework";

export interface AiricHttpHandlerOptions {
  runtime: AiricRuntime;
  basePath?: string;
  definitions?: () => Promise<readonly { id: string; title: string; digest: string }[]>;
  getDefinition?: (id: string) => Promise<{ digest: string; files: Readonly<Record<string, string>> }>;
  workspaceStatus?: () => Promise<{ gitHead?: string; dirty: boolean; status: string; diff: string }>;
  saveUpload?: (input: { name: string; mediaType: string; contentBase64: string }) => Promise<{ ref: unknown }>;
  authenticate?: (request: IncomingMessage) => Promise<TrustedCallContext["actor"]>;
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
  const clients = new Set<ServerResponse>();
  const unsubscribe = options.runtime.subscribe((event) => { const data = encodeSse(event); for (const client of clients) client.write(data); });
  let closed = false;
  return {
    async handle(request, response) {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) return false;
      const path = url.pathname.slice(basePath.length) || "/";
      try {
        if (closed) return json(response, 503, { error: "Airic HTTP handler is closed", code: "HandlerClosed" });
        if (path === "/health") return json(response, 200, { ok: true });
        if (path === "/events" && request.method === "GET") {
          response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
          const lastId = lastEventId(request, url);
          const events = options.runtime.listWorks().flatMap((work) => [...options.runtime.getTrace(work.id)]).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
          const start = typeof lastId === "string" ? Math.max(0, events.findIndex((event) => event.eventId === lastId) + 1) : events.length;
          for (const event of events.slice(start)) response.write(encodeSse(event));
          response.write(": connected\n\n"); clients.add(response); request.on("close", () => clients.delete(response)); return true;
        }
        if (path === "/works" && request.method === "GET") return json(response, 200, options.runtime.listWorks());
        if (path === "/works" && request.method === "POST") return json(response, 201, await options.runtime.createWork(await bodyJson(request) as never));
        if (path === "/capabilities" && request.method === "GET") return json(response, 200, options.runtime.options.harness.capabilities());
        if (path === "/workspace" && request.method === "GET") return options.workspaceStatus ? json(response, 200, await options.workspaceStatus()) : json(response, 501, { error: "Workspace status is not configured", code: "NotConfigured" });
        if (path === "/definitions" && request.method === "GET") return json(response, 200, await options.definitions?.() ?? []);
        const definitionMatch = path.match(/^\/definitions\/([^/]+)$/u);
        if (definitionMatch && request.method === "GET") return options.getDefinition ? json(response, 200, await options.getDefinition(decodeURIComponent(definitionMatch[1]!))) : json(response, 501, { error: "Definition reading is not configured", code: "NotConfigured" });
        if (path === "/uploads" && request.method === "POST") return options.saveUpload ? json(response, 201, await options.saveUpload(await bodyJson(request) as never)) : json(response, 501, { error: "Uploads are not configured", code: "NotConfigured" });
        const match = path.match(/^\/works\/([^/]+)(?:\/(trace|messages|complete|interrupt|reflection|reflection-outcome|uploads))?$/u);
        if (match) {
          const workId = decodeURIComponent(match[1]!); const operation = match[2];
          if (!operation && request.method === "GET") { const work = options.runtime.getWork(workId); return work ? json(response, 200, { work, trace: options.runtime.getTrace(workId) }) : json(response, 404, { error: "Work not found", code: "WorkNotFound" }); }
          if (operation === "trace" && request.method === "GET") return json(response, 200, options.runtime.getTrace(workId));
          if (operation === "messages" && request.method === "POST") { const actor = await authenticate(options, request); const body = await bodyJson(request) as { message: string }; return json(response, 200, await options.runtime.sendMessage(workId, body.message, actor)); }
          if (operation === "complete" && request.method === "POST") return json(response, 200, await options.runtime.completeWork(workId, (await bodyJson(request) as { result: unknown }).result));
          if (operation === "interrupt" && request.method === "POST") { await options.runtime.interrupt(workId); return json(response, 202, { interrupted: true }); }
          if (operation === "reflection" && request.method === "POST") return json(response, 201, await options.runtime.recordReflectionCandidate(workId, await bodyJson(request) as never));
          if (operation === "reflection-outcome" && request.method === "POST") { await options.runtime.recordReflectionOutcome(workId, await bodyJson(request) as never); return json(response, 201, { recorded: true }); }
          if (operation === "uploads" && request.method === "POST") { const body = await bodyJson(request) as { name: string; mediaType: string; contentBase64: string }; return json(response, 201, await options.runtime.attachEvidence(workId, { name: body.name, mediaType: body.mediaType, content: Buffer.from(body.contentBase64, "base64") })); }
        }
        return json(response, 404, { error: "Airic route not found", code: "RouteNotFound" });
      } catch (error) { return json(response, 400, { error: error instanceof Error ? error.message : String(error), code: error instanceof SyntaxError ? "InvalidJson" : "RequestFailed" }); }
    },
    async close() { if (closed) return; closed = true; unsubscribe(); for (const client of clients) client.end(); clients.clear(); },
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
async function authenticate(options: AiricHttpHandlerOptions, request: IncomingMessage) { return options.authenticate?.(request) ?? { id: "local-user", scopes: ["airic:local"] }; }
async function bodyJson(request: IncomingMessage): Promise<unknown> { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; }
function json(response: ServerResponse, status: number, value: unknown): true { response.writeHead(status, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify(value)); return true; }
function encodeSse(event: TraceEvent): string { return `id: ${event.eventId}\nevent: trace\ndata: ${JSON.stringify(event)}\n\n`; }
async function servePath(base: string, pathname: string, response: ServerResponse, spaFallback: (pathname: string) => boolean): Promise<boolean> {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const path = resolve(base, requested);
  if (path !== base && !path.startsWith(`${base}${sep}`)) { json(response, 403, { error: "Forbidden", code: "Forbidden" }); return true; }
  let target = path;
  try { if ((await stat(target)).isDirectory()) target = resolve(target, "index.html"); } catch { if (!extname(requested) && spaFallback(pathname)) target = resolve(base, "index.html"); }
  try { const info = await stat(target); response.writeHead(200, { "content-type": mime(target), "content-length": info.size }); createReadStream(target).pipe(response); return true; } catch { return false; }
}
function mime(path: string): string { return ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" } as Record<string, string>)[extname(path)] ?? "application/octet-stream"; }
