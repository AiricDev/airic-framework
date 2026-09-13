import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiricRuntime, TraceEvent } from "@airic/framework";
import { createAiricHttpHandler, createAiricServer, createStaticHandler } from "../src/index.js";
const authenticated = async () => ({ id: "browser-user", scopes: ["work:write"] });
const authorize = () => true;
const testWork = { id: "work-1", createdBy: "browser-user", workType: { moduleId: "cases", workTypeId: "assist" } };

const closing: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closing.splice(0).map((close) => close())); });

async function listen(handle: (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => void): Promise<string> {
  const server = createServer(handle);
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("missing address");
  closing.push(async () => { await new Promise<void>((resolveClose) => server.close(() => resolveClose())); });
  return `http://127.0.0.1:${address.port}`;
}

describe("Airic HTTP hosting", () => {
  it("denies anonymous access and filters Work lists and trace with the same host policy", async () => {
    const own = { ...testWork, id: "own" };
    const other = { ...testWork, id: "other", createdBy: "someone-else" };
    const runtime = fakeRuntime({ listWorks: () => [own, other], getWork: (id: string) => id === "own" ? own : id === "other" ? other : undefined, getTrace: (id: string) => [traceEvent(id)] });
    const airic = createAiricHttpHandler({ runtime, authenticate: async (request) => { if (!request.headers.cookie) throw new Error("No session"); return authenticated(); },
      authorize: (actor, resource) => resource.kind === "work" ? resource.work.createdBy === actor.id : true });
    const base = await listen((request, response) => { void airic.handle(request, response); });
    expect((await fetch(`${base}/api/airic/works`)).status).toBe(401);
    const headers = { cookie: "signed=demo" };
    expect((await (await fetch(`${base}/api/airic/works`, { headers })).json())).toHaveLength(1);
    expect((await fetch(`${base}/api/airic/works/other/trace`, { headers })).status).toBe(403);
    const connection = await fetch(`${base}/api/airic/works/own/agent-connection`, { headers });
    expect(connection.status).toBe(501);
    await airic.close();
  });
  it("mounts below a base path without consuming application routes", async () => {
    let actor: unknown;
    const runtime = fakeRuntime({ getWork: () => testWork, sendMessage: async (_workId: string, _message: string, value: unknown) => { actor = value; return { text: "ok" }; } });
    const airic = createAiricHttpHandler({ runtime, basePath: "/api/airic", authenticate: authenticated, authorize });
    const base = await listen(async (request, response) => {
      if (request.url === "/api/app/health") { response.writeHead(200, { "content-type": "application/json" }); response.end('{"app":true}'); return; }
      if (await airic.handle(request, response)) return;
      response.writeHead(404); response.end();
    });
    expect(await (await fetch(`${base}/api/app/health`)).json()).toEqual({ app: true });
    expect(await (await fetch(`${base}/api/airic/health`)).json()).toEqual({ ok: true });
    expect((await fetch(`${base}/api/airic-other/health`)).status).toBe(404);
    await fetch(`${base}/api/airic/works/work-1/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"message":"hello"}' });
    expect(actor).toEqual({ id: "browser-user", scopes: ["work:write"] });
    await airic.close();
  });

  it("returns false without touching the response outside the base path", async () => {
    const airic = createAiricHttpHandler({ runtime: fakeRuntime(), basePath: "/api/airic", authenticate: authenticated, authorize });
    const writeHead = vi.fn(); const end = vi.fn(); const write = vi.fn();
    const handled = await airic.handle(
      { url: "/api/app/cases", method: "GET", headers: {} } as unknown as import("node:http").IncomingMessage,
      { writeHead, end, write } as unknown as import("node:http").ServerResponse,
    );
    expect(handled).toBe(false);
    expect(writeHead).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it("returns structured JSON errors for invalid request bodies", async () => {
    const airic = createAiricHttpHandler({ runtime: fakeRuntime(), basePath: "/api/airic", authenticate: authenticated, authorize });
    const base = await listen((request, response) => { void airic.handle(request, response).then((handled) => { if (!handled) { response.writeHead(404); response.end(); } }); });
    const response = await fetch(`${base}/api/airic/works`, { method: "POST", headers: { "content-type": "application/json" }, body: "{oops" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "InvalidJson", error: expect.any(String) });
    await airic.close();
  });

  it("resumes the event stream from the last event id and ends clients on close", async () => {
    const events: TraceEvent[] = [traceEvent("e1"), traceEvent("e2"), traceEvent("e3")];
    const runtime = fakeRuntime({ listWorks: () => [testWork], getWork: () => testWork, getTrace: () => events, subscribe: () => () => {} });
    const airic = createAiricHttpHandler({ runtime, basePath: "/api/airic", authenticate: authenticated, authorize });
    const base = await listen((request, response) => { void airic.handle(request, response).then((handled) => { if (!handled) { response.writeHead(404); response.end(); } }); });

    const resumed = await fetch(`${base}/api/airic/events?lastEventId=e2`);
    expect(resumed.headers.get("content-type")).toBe("text/event-stream");
    let text = "";
    const reader = resumed.body!.getReader(); const decoder = new TextDecoder();
    while (!text.includes("e3")) { const { done, value } = await reader.read(); if (done) break; text += decoder.decode(value); }
    expect(text).toContain("\"eventId\":\"e3\"");
    expect(text).not.toContain("\"eventId\":\"e1\"");

    const fresh = await fetch(`${base}/api/airic/events`);
    const freshReader = fresh.body!.getReader();
    const first = await freshReader.read();
    expect(decoder.decode(first.value ?? new Uint8Array())).not.toContain("\"eventId\":");
    await freshReader.cancel();

    await airic.close();
    expect((await reader.read()).done).toBe(true);
    expect((await fetch(`${base}/api/airic/health`)).status).toBe(503);
  });

  it("stops an SSE stream when the host revokes Work visibility", async () => {
    let authorized = true;
    let publish: ((event: TraceEvent) => void) | undefined;
    const runtime = fakeRuntime({ listWorks: () => [testWork], getWork: () => testWork,
      subscribe: (listener: (event: TraceEvent) => void) => { publish = listener; return () => { publish = undefined; }; } });
    const airic = createAiricHttpHandler({ runtime, authenticate: authenticated, authorize: (_actor, resource) => resource.kind !== "work" || authorized });
    const base = await listen((request, response) => { void airic.handle(request, response); });
    const stream = await fetch(`${base}/api/airic/events`);
    const reader = stream.body!.getReader();
    await reader.read(); // initial connected frame
    authorized = false;
    publish?.(traceEvent("revoked"));
    expect((await reader.read()).done).toBe(true);
    await airic.close();
  });

  it("serves static assets with an SPA fallback and defers unknown files", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "airic-static-"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(resolve(directory, "index.html"), "<h1>app shell</h1>");
    await writeFile(resolve(directory, "app.js"), "console.log('asset');");
    const files = createStaticHandler({ directory });
    const base = await listen(async (request, response) => {
      if (await files.handle(request, response)) return;
      response.writeHead(404, { "content-type": "application/json" }); response.end('{"fallback":true}');
    });
    expect(await (await fetch(`${base}/`)).text()).toContain("app shell");
    expect(await (await fetch(`${base}/app.js`)).text()).toContain("asset");
    expect(await (await fetch(`${base}/cases/demo`)).text()).toContain("app shell");
    expect(await (await fetch(`${base}/api/unknown`)).json()).toEqual({ fallback: true });
    expect(await (await fetch(`${base}/missing.js`)).json()).toEqual({ fallback: true });
    expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(404);
  });

  it("keeps the legacy convenience server on /api", async () => {
    const app = createAiricServer({ runtime: fakeRuntime(), port: 0 }); const address = await app.listen(); closing.push(() => app.close());
    expect(await (await fetch(`http://${address.host}:${address.port}/api/health`)).json()).toEqual({ ok: true });
  });
});

function traceEvent(eventId: string): TraceEvent {
  return { eventId, workId: "work-1", type: "work.created", timestamp: `2026-01-01T00:00:00.${eventId.padStart(3, "0")}Z`, actor: "system", payload: {} };
}

function fakeRuntime(overrides: Record<string, unknown> = {}): AiricRuntime {
  return {
    subscribe: () => () => {}, listWorks: () => [], getTrace: () => [], getWork: () => undefined,
    createWork: async () => ({}), sendMessage: async () => ({ text: "ok" }), completeWork: async () => ({}), interrupt: async () => {},
    recordReflectionCandidate: async () => ({}), recordReflectionOutcome: async () => {}, attachEvidence: async () => ({ ref: {} }),
    options: { harness: { capabilities: () => ({ resume: false, interrupt: false, contextHook: false, compactionTrace: false }), run: async () => ({ text: "" }) } },
    ...overrides,
  } as unknown as AiricRuntime;
}
