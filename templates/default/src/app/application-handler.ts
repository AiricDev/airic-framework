import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

export interface AppActor { id: string; scopes: readonly string[] }

export interface AppRouteContext {
  request: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  actor: AppActor;
  commandId: string;
}

export interface AppRouteResult { status?: number; body?: unknown; headers?: Readonly<Record<string, string>> }

export interface AppRoute {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  handle(context: AppRouteContext): Promise<AppRouteResult>;
}

export interface AppHttpHandlerOptions {
  routes: readonly AppRoute[];
  basePath?: string;
  authenticate?: (request: IncomingMessage) => Promise<AppActor> | AppActor;
}

export interface AppHttpHandler { handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> }

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message); this.name = "HttpError"; }
}

export function sendJson(response: ServerResponse, status: number, value: unknown, headers: Readonly<Record<string, string>> = {}): true {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(value));
  return true;
}

export function createAppHttpHandler(options: AppHttpHandlerOptions): AppHttpHandler {
  const basePath = normalizeBasePath(options.basePath ?? "/api/app");
  const identities = new Set<string>();
  for (const route of options.routes) { const id = `${route.method} ${route.path}`; if (identities.has(id)) throw new Error(`Application route conflict: ${id}`); identities.add(id); }
  return {
    async handle(request, response) {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) return false;
      const method = request.method ?? "GET";
      const path = url.pathname.slice(basePath.length) || "/";
      try {
        const route = matchRoute(options.routes, method, path);
        if (!route) return sendJson(response, 404, { error: `No application route for ${method} ${path}`, code: "AppRouteNotFound" });
        const body = method === "GET" ? undefined : await readJsonBody(request);
        const actor = options.authenticate ? await options.authenticate(request) : { id: "local-user", scopes: [] };
        const result = await route.route.handle({ request, params: route.params, query: url.searchParams, body, actor, commandId: `app:${randomUUID()}` });
        return sendJson(response, result.status ?? 200, result.body ?? null, result.headers);
      } catch (error) {
        if (error instanceof HttpError) return sendJson(response, error.status, { error: error.message, code: error.code, ...(error.details === undefined ? {} : { details: error.details }) });
        return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error), code: "RequestFailed" });
      }
    },
  };
}

interface MatchedRoute { route: AppRoute; params: Record<string, string> }

function matchRoute(routes: readonly AppRoute[], method: string, path: string): MatchedRoute | undefined {
  const segments = path.split("/").filter(Boolean);
  for (const route of routes) {
    if (route.method !== method) continue;
    const pattern = route.path.split("/").filter(Boolean);
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < pattern.length; index += 1) {
      const part = pattern[index]!;
      if (part.startsWith(":")) params[part.slice(1)] = decodeURIComponent(segments[index]!);
      else if (part !== segments[index]) { matched = false; break; }
    }
    if (matched) return { route, params };
  }
  return undefined;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "InvalidJson", "The request body is not valid JSON"); }
}

function normalizeBasePath(value: string): string { const path = `/${value}`.replace(/\/{2,}/gu, "/").replace(/\/$/u, ""); return path || "/"; }
