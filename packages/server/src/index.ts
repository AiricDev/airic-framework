import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import type { AiricRuntime, TraceEvent, TrustedCallContext } from "@airic/framework";

export interface AiricServerOptions {
  runtime: AiricRuntime; host?: string; port?: number; staticDirectory?: string;
  definitions?: () => Promise<readonly { id: string; title: string; revision?: string }[]>;
  getDefinition?: (id: string) => Promise<{ revision: string; files: Readonly<Record<string, string>> }>;
  publishDefinition?: (input: { id: string; files: Readonly<Record<string, string>>; baseRevision?: string }) => Promise<{ revision: string }>;
  saveUpload?: (input: { name: string; mediaType: string; contentBase64: string }) => Promise<{ ref: unknown }>;
  authenticate?: (request: IncomingMessage) => Promise<TrustedCallContext["actor"]>;
}

export function createAiricServer(options: AiricServerOptions) {
  const clients = new Set<ServerResponse>();
  const unsubscribe = options.runtime.subscribe((event) => { const data = encodeSse(event); for (const client of clients) client.write(data); });
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (url.pathname === "/api/health") return json(response, 200, { ok: true });
      if (url.pathname === "/api/events" && request.method === "GET") {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        const lastId = request.headers["last-event-id"];
        const events = options.runtime.listWorks().flatMap((work) => [...options.runtime.getTrace(work.id)]).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        const start = typeof lastId === "string" ? Math.max(0, events.findIndex((event) => event.eventId === lastId) + 1) : events.length;
        for (const event of events.slice(start)) response.write(encodeSse(event));
        response.write(": connected\n\n"); clients.add(response); request.on("close", () => clients.delete(response)); return;
      }
      if (url.pathname === "/api/works" && request.method === "GET") return json(response, 200, options.runtime.listWorks());
      if (url.pathname === "/api/works" && request.method === "POST") return json(response, 201, await options.runtime.createWork(await bodyJson(request) as never));
      if (url.pathname === "/api/definitions" && request.method === "GET") return json(response, 200, await options.definitions?.() ?? []);
      const definitionMatch = url.pathname.match(/^\/api\/definitions\/([^/]+)$/);
      if (definitionMatch && request.method === "GET") return options.getDefinition ? json(response, 200, await options.getDefinition(decodeURIComponent(definitionMatch[1]!))) : json(response, 501, { error: "Definition reading is not configured" });
      if (url.pathname === "/api/definitions/publish" && request.method === "POST") return options.publishDefinition ? json(response, 201, await options.publishDefinition(await bodyJson(request) as never)) : json(response, 501, { error: "Definition publishing is not configured" });
      if (url.pathname === "/api/uploads" && request.method === "POST") return options.saveUpload ? json(response, 201, await options.saveUpload(await bodyJson(request) as never)) : json(response, 501, { error: "Uploads are not configured" });
      const match = url.pathname.match(/^\/api\/works\/([^/]+)(?:\/(trace|messages|complete|interrupt|rebind|reflection|reflection-outcome|uploads))?$/);
      if (match) {
        const workId = decodeURIComponent(match[1]!); const operation = match[2];
        if (!operation && request.method === "GET") { const work = options.runtime.getWork(workId); return work ? json(response, 200, { work, trace: options.runtime.getTrace(workId) }) : json(response, 404, { error: "Work not found" }); }
        if (operation === "trace" && request.method === "GET") return json(response, 200, options.runtime.getTrace(workId));
        if (operation === "messages" && request.method === "POST") { const actor = await authenticate(options, request); const body = await bodyJson(request) as { message: string }; return json(response, 200, await options.runtime.sendMessage(workId, body.message, actor)); }
        if (operation === "complete" && request.method === "POST") return json(response, 200, await options.runtime.completeWork(workId, (await bodyJson(request) as { result: unknown }).result));
        if (operation === "interrupt" && request.method === "POST") { await options.runtime.interrupt(workId); return json(response, 202, { interrupted: true }); }
        if (operation === "rebind" && request.method === "POST") return json(response, 200, await options.runtime.rebindWork(workId));
        if (operation === "reflection" && request.method === "POST") return json(response, 201, await options.runtime.recordReflectionCandidate(workId, await bodyJson(request) as never));
        if (operation === "reflection-outcome" && request.method === "POST") { await options.runtime.recordReflectionOutcome(workId, await bodyJson(request) as never); return json(response, 201, { recorded: true }); }
        if (operation === "uploads" && request.method === "POST") { const body = await bodyJson(request) as { name: string; mediaType: string; contentBase64: string }; return json(response, 201, await options.runtime.attachEvidence(workId, { name: body.name, mediaType: body.mediaType, content: Buffer.from(body.contentBase64, "base64") })); }
      }
      if (options.staticDirectory && request.method === "GET") return serveStatic(options.staticDirectory, url.pathname, response);
      json(response, 404, { error: "Not found" });
    } catch (error) { json(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
  });
  return {
    server,
    listen: () => new Promise<{ host: string; port: number }>((resolveListen, reject) => { server.once("error", reject); server.listen(options.port ?? 4173, options.host ?? "127.0.0.1", () => { server.off("error", reject); const address = server.address(); if (!address || typeof address === "string") return reject(new Error("Server did not bind a TCP address")); resolveListen({ host: address.address, port: address.port }); }); }),
    close: () => new Promise<void>((resolveClose, reject) => { unsubscribe(); for (const client of clients) client.end(); server.close((error) => error ? reject(error) : resolveClose()); }),
  };
}
async function authenticate(options: AiricServerOptions, request: IncomingMessage) { return options.authenticate?.(request) ?? { id: "local-user", scopes: ["airic:local"] }; }
async function bodyJson(request: IncomingMessage): Promise<unknown> { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; }
function json(response: ServerResponse, status: number, value: unknown): void { response.writeHead(status, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify(value)); }
function encodeSse(event: TraceEvent): string { return `id: ${event.eventId}\nevent: trace\ndata: ${JSON.stringify(event)}\n\n`; }
async function serveStatic(root: string, pathname: string, response: ServerResponse): Promise<void> { const base = resolve(root); const requested = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1)); const path = resolve(base, requested); if (path !== base && !path.startsWith(`${base}${sep}`)) return json(response, 403, { error: "Forbidden" }); let target = path; try { if ((await stat(target)).isDirectory()) target = resolve(target, "index.html"); } catch { if (!extname(requested)) target = resolve(base, "index.html"); } try { const info = await stat(target); response.writeHead(200, { "content-type": mime(target), "content-length": info.size }); createReadStream(target).pipe(response); } catch { json(response, 404, { error: "Not found" }); } }
function mime(path: string): string { return ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" } as Record<string, string>)[extname(path)] ?? "application/octet-stream"; }
