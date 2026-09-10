import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { AiricRuntime } from "@airic/framework";
import { createAiricHttpHandler, createAiricServer } from "../src/index.js";

const closing: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closing.splice(0).map((close) => close())); });

describe("Airic HTTP hosting", () => {
  it("mounts below a base path without consuming application routes", async () => {
    let actor: unknown;
    const runtime = fakeRuntime({ sendMessage: async (_workId: string, _message: string, value: unknown) => { actor = value; return { text: "ok" }; } });
    const airic = createAiricHttpHandler({ runtime, basePath: "/api/airic", authenticate: async () => ({ id: "browser-user", scopes: ["work:write"] }) });
    const server = createServer(async (request, response) => {
      if (request.url === "/api/app/health") { response.writeHead(200, { "content-type": "application/json" }); response.end('{"app":true}'); return; }
      if (await airic.handle(request, response)) return;
      response.writeHead(404); response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("missing address");
    closing.push(async () => { await airic.close(); await new Promise<void>((resolve) => server.close(() => resolve())); });
    const base = `http://127.0.0.1:${address.port}`;
    expect(await (await fetch(`${base}/api/app/health`)).json()).toEqual({ app: true });
    expect(await (await fetch(`${base}/api/airic/health`)).json()).toEqual({ ok: true });
    expect((await fetch(`${base}/api/airic-other/health`)).status).toBe(404);
    await fetch(`${base}/api/airic/works/work-1/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"message":"hello"}' });
    expect(actor).toEqual({ id: "browser-user", scopes: ["work:write"] });
  });

  it("keeps the legacy convenience server on /api", async () => {
    const app = createAiricServer({ runtime: fakeRuntime(), port: 0 }); const address = await app.listen(); closing.push(() => app.close());
    expect(await (await fetch(`http://${address.host}:${address.port}/api/health`)).json()).toEqual({ ok: true });
  });
});

function fakeRuntime(overrides: Record<string, unknown> = {}): AiricRuntime {
  return {
    subscribe: () => () => {}, listWorks: () => [], getTrace: () => [], getWork: () => undefined,
    createWork: async () => ({}), sendMessage: async () => ({ text: "ok" }), completeWork: async () => ({}), interrupt: async () => {},
    recordReflectionCandidate: async () => ({}), recordReflectionOutcome: async () => {}, attachEvidence: async () => ({ ref: {} }),
    options: { harness: { capabilities: () => ({ resume: false, interrupt: false, contextHook: false, compactionTrace: false }), run: async () => ({ text: "" }) } },
    ...overrides,
  } as unknown as AiricRuntime;
}
