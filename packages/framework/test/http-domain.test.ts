import { createHttpDomainProvider } from "../src/integration/http-domain.js";
import { describe, expect, it } from "vitest";

describe("HTTP domain provider", () => {
  it("maps a remote manifest, invocation and command inspection onto the domain port", async () => {
    const calls: string[] = [];
    const fetch = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/manifest")) return new Response(JSON.stringify({ protocolVersion: "airic-domain/v1", domain: { id: "reports", release: "1.0.0" }, capabilities: [{ id: "report.read", title: "Read", description: "Read report", kind: "query", inputSchema: { type: "object" }, outputSchema: { type: "object" } }] }), { status: 200 });
      if (url.includes("queries/report.read")) return new Response(JSON.stringify({ report: "r-1" }), { status: 200 });
      return new Response(JSON.stringify({ commandId: "c-1", status: "committed", observedAt: "2026-01-01T00:00:00Z" }), { status: 200 });
    };
    const provider = await createHttpDomainProvider({ baseUrl: "https://cert.example/", moduleId: "reports", fetch: fetch as typeof globalThis.fetch });
    expect(provider.id).toBe("reports");
    await expect(provider.capabilities[0]!.invoke({ actor: { id: "a", scopes: [] }, workId: "w", workType: { moduleId: "m", workTypeId: "t", operatingDigest: "d" }, expectedDomainRelease: "1.0.0" }, {})).resolves.toEqual({ report: "r-1" });
    await expect(provider.inspectCommand!({ actor: { id: "a", scopes: [] }, workId: "w", workType: { moduleId: "m", workTypeId: "t", operatingDigest: "d" }, expectedDomainRelease: "1.0.0" }, "c-1")).resolves.toMatchObject({ commandId: "c-1" });
    expect(calls).toEqual(["GET https://cert.example/airic/v1/manifest", "POST https://cert.example/airic/v1/queries/report.read", "GET https://cert.example/airic/v1/commands/c-1"]);
  });

  it("uses composition-root request headers for every transport request without exposing a prompt", async () => {
    const signed: Array<{ kind: string; path: string; body?: string; actor?: string }> = [];
    const fetch = async (url: string, init?: RequestInit) => {
      if (url.endsWith("/manifest")) return new Response(JSON.stringify({ protocolVersion: "airic-domain/v1", domain: { id: "reports", release: "1" }, capabilities: [{ id: "report.write", title: "Write", description: "Write", kind: "command", inputSchema: { type: "object" }, outputSchema: { type: "object" } }] }));
      return new Response(JSON.stringify({ commandId: "c", status: "committed" }));
    };
    const provider = await createHttpDomainProvider({
      baseUrl: "https://cert.example", moduleId: "reports", fetch: fetch as typeof globalThis.fetch,
      requestHeaders: async (request) => { signed.push({ kind: request.kind, path: request.path, body: request.body, actor: request.context?.actor.id }); return { "x-signed": "yes" }; },
    });
    await provider.capabilities[0]!.invoke({ actor: { id: "actual-user", scopes: [] }, workId: "w", workType: { moduleId: "m", workTypeId: "t", operatingDigest: "d" }, actionId: "a", commandId: "c", expectedDomainRelease: "1" }, { value: 1 });
    await provider.inspectCommand!({ actor: { id: "actual-user", scopes: [] }, workId: "w", workType: { moduleId: "m", workTypeId: "t", operatingDigest: "d" }, expectedDomainRelease: "1" }, "c");
    expect(signed).toEqual([
      { kind: "manifest", path: "/airic/v1/manifest", actor: undefined },
      { kind: "command", path: "/airic/v1/commands/report.write", body: expect.stringContaining('"commandId":"c"'), actor: "actual-user" },
      { kind: "inspection", path: "/airic/v1/commands/c", actor: "actual-user" },
    ]);
  });
});
