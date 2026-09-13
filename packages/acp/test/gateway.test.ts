import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ClientSideConnection, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client";
import { WebSocket } from "ws";
import type { AiricRuntime, LiveWorkEvent, TraceEvent, Work } from "@airic/framework";
import { createAiricAcpGateway } from "../src/index.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close(); });

it("binds one authenticated Work session, streams and replays canonical trace via the official SDK", async () => {
  const work = { id: "work-1", createdBy: "author", status: "open", workType: { moduleId: "semi-s2", workTypeId: "semi-s2-report" } } as Work;
  const trace: TraceEvent[] = [];
  const live = new Set<(event: LiveWorkEvent) => void>();
  const traceListeners = new Set<(event: TraceEvent) => void>();
  let releaseSlowTurn: (() => void) | undefined;
  let slowTurnStarted: (() => void) | undefined;
  const started = new Promise<void>((resolveStarted) => { slowTurnStarted = resolveStarted; });
  const runtime = {
    getWork: (id: string) => id === work.id ? work : undefined,
    getTrace: () => trace,
    subscribe: (listener: (event: TraceEvent) => void) => { traceListeners.add(listener); return () => traceListeners.delete(listener); },
    subscribeLive: (listener: (event: LiveWorkEvent) => void) => { live.add(listener); return () => live.delete(listener); },
    sendMessage: async (_id: string, message: string) => {
      if (message === "Slow") { slowTurnStarted?.(); await new Promise<void>((release) => { releaseSlowTurn = release; }); return { text: "Interrupted" }; }
      const user = { schemaVersion: 1, eventId: "u", workId: work.id, type: "message.user", actor: "author", timestamp: "2026-01-01T00:00:00Z", payload: { text: message } } as TraceEvent;
      trace.push(user); for (const listener of traceListeners) listener(user);
      const toolStart = { ...user, eventId: "t1", type: "tool.execution", actor: "harness", payload: { phase: "start", name: "domain_report_get", providerEventId: "call-1" } } as TraceEvent;
      trace.push(toolStart); for (const listener of traceListeners) listener(toolStart);
      for (const listener of live) listener({ workId: work.id, type: "text-delta", text: "Hello" });
      const toolEnd = { ...toolStart, eventId: "t2", payload: { phase: "end", name: "domain_report_get", providerEventId: "call-1", isError: false } } as TraceEvent;
      trace.push(toolEnd); for (const listener of traceListeners) listener(toolEnd);
      const agent = { ...user, eventId: "a", type: "message.agent", actor: "agent", payload: { text: "Hello" } } as TraceEvent;
      trace.push(agent); for (const listener of traceListeners) listener(agent);
      return { text: "Hello" };
    },
    interrupt: async () => { releaseSlowTurn?.(); },
  } as unknown as AiricRuntime;
  const sessionDirectory = await mkdtemp(resolve(tmpdir(), "airic-acp-"));
  let canPrompt = true;
  const server = createServer((_request, response) => { response.writeHead(404).end(); });
  await new Promise<void>((done, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", () => { server.off("error", fail); done(); }); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No address");
  const origin = `http://127.0.0.1:${address.port}`;
  const gatewayOptions = { runtime, cwd: process.cwd(), sessionDirectory, origin,
    authenticate: async (request) => request.headers.cookie === "actor=author" ? { id: "author", scopes: [] } : { id: "other", scopes: [] },
    authorize: (actor, resource) => resource.kind === "work" && actor.id === resource.work.createdBy && (resource.action !== "prompt" || canPrompt),
  } satisfies Parameters<typeof createAiricAcpGateway>[0];
  let gateway = createAiricAcpGateway(gatewayOptions);
  server.on("upgrade", (request, socket, head) => { void gateway.handleUpgrade(request, socket, head); });
  closers.push(async () => { await gateway.close(); await new Promise<void>((done) => server.close(() => done())); });
  const url = `ws://127.0.0.1:${address.port}/api/airic/works/work-1/acp`;
  const updates: unknown[] = [];
  async function connect() {
    const connection = new ClientSideConnection(() => ({
      sessionUpdate: async (value: unknown) => { updates.push(value); },
      requestPermission: async () => ({ outcome: { outcome: "cancelled" as const } }),
    }), createWebSocketStream(url, { WebSocket, headers: { Cookie: "actor=author", Origin: origin } }));
    await connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
    return connection;
  }
  const client = await connect();
  const session = await client.newSession({ cwd: process.cwd(), mcpServers: [] });
  await expect(client.newSession({ cwd: process.cwd(), mcpServers: [] })).rejects.toThrow();
  await expect(client.newSession({ cwd: "/tmp", mcpServers: [] })).rejects.toThrow();
  expect(await client.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "Hi" }] })).toMatchObject({ stopReason: "end_turn" });
  expect(JSON.stringify(updates)).toContain("Hello");
  expect(JSON.stringify(updates)).toContain("tool_call_update");
  canPrompt = false;
  await expect(client.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "After revocation" }] })).rejects.toThrow(/WorkAccessDenied/u);
  canPrompt = true;
  const reconnected = await connect();
  await reconnected.loadSession({ sessionId: session.sessionId, cwd: process.cwd(), mcpServers: [] });
  expect(JSON.stringify(updates)).toContain("user_message_chunk");
  expect(JSON.stringify(updates)).toContain("agent_message_chunk");
  await expect(reconnected.prompt({ sessionId: "forged-session", prompt: [{ type: "text", text: "Hi" }] })).rejects.toThrow();
  const slowPrompt = client.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "Slow" }] });
  await started;
  await expect(reconnected.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "Concurrent" }] })).rejects.toThrow(/WorkBusy/u);
  await reconnected.cancel({ sessionId: session.sessionId });
  expect(await slowPrompt).toMatchObject({ stopReason: "cancelled" });
  const blocked = new WebSocket(url, { headers: { Cookie: "actor=other", Origin: origin } });
  await expect(new Promise((done, fail) => { blocked.once("open", done); blocked.once("error", fail); })).rejects.toThrow();
  const wrongOrigin = new WebSocket(url, { headers: { Cookie: "actor=author", Origin: "https://evil.invalid" } });
  await expect(new Promise((done, fail) => { wrongOrigin.once("open", done); wrongOrigin.once("error", fail); })).rejects.toThrow();
  await gateway.close();
  gateway = createAiricAcpGateway(gatewayOptions);
  const afterRestart = await connect();
  await afterRestart.loadSession({ sessionId: session.sessionId, cwd: process.cwd(), mcpServers: [] });
  expect(JSON.stringify(updates)).toContain("tool_call_update");
});
