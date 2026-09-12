import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CaseService } from "../application/case-service.js";
import { JsonCaseRepository } from "../infrastructure/json-case-repository.js";
import { createAppHttpHandler, sendJson, type AppRoute } from "../../../app/application-handler.js";
import { resolveActor } from "../../../app/actor.js";
import { createAppRoutes } from "../experience/http-routes.js";

let server: Server;
let base = "";

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), "app-handler-"));
  const repository = new JsonCaseRepository(join(root, "cases.json"));
  await repository.initialize();
  const cases = new CaseService(repository);
  const actorProbe: AppRoute = { method: "GET", path: "/actor", handle: async (context) => ({ body: { actor: context.actor } }) };
  const handler = createAppHttpHandler({ routes: [...createAppRoutes({ cases }), actorProbe], authenticate: resolveActor });
  server = createServer(async (request, response) => {
    if (await handler.handle(request, response)) return;
    sendJson(response, 404, { error: "Not found", code: "RouteNotFound" });
  });
  await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolveListen(); }); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolveClose) => server.close(() => resolveClose())); });

describe("application HTTP handler", () => {
  it("serves the case list through the module business API", async () => {
    const list = await (await fetch(`${base}/api/app/cases`)).json();
    expect(list.cases).toEqual([{ id: "demo", status: "draft", revision: 1 }]);
    const single = await (await fetch(`${base}/api/app/cases/demo`)).json();
    expect(single.case.id).toBe("demo");
  });

  it("returns 404 for an unknown case and an unknown application route", async () => {
    const missing = await fetch(`${base}/api/app/cases/missing`);
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("CaseNotFound");
    const unrouted = await fetch(`${base}/api/app/nothing-here`);
    expect(unrouted.status).toBe(404);
    expect((await unrouted.json()).code).toBe("AppRouteNotFound");
  });

  it("commits with a host-owned identity and maps policy failures", async () => {
    const command = { commandId: "caller-controlled", expectedRevision: 1, changes: { customerName: "Ada Lovelace" } };
    const committed = await fetch(`${base}/api/app/cases/demo/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) });
    expect(committed.status).toBe(201);
    const committedBody = await committed.json();
    expect(committedBody.receipt).toMatchObject({ commandId: expect.stringMatching(/^app:/u), status: "committed", revision: "2" });
    expect(committedBody.receipt.commandId).not.toBe("caller-controlled");
    const repeated = await fetch(`${base}/api/app/cases/demo/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) });
    expect(repeated.status).toBe(409);
    expect((await repeated.json()).code).toBe("RevisionConflict");
    const invalid = await fetch(`${base}/api/app/cases/demo/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 2, changes: { markReady: true } }) });
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).code).toBe("RequiredInformationMissing");
    const inspected = await (await fetch(`${base}/api/app/commands/${encodeURIComponent(committedBody.receipt.commandId)}`)).json();
    expect(inspected.receipt.commandId).toBe(committedBody.receipt.commandId);
  });

  it("establishes the trusted actor from the host, not from HTTP input", async () => {
    const anonymous = await (await fetch(`${base}/api/app/actor`)).json();
    expect(anonymous.actor).toEqual({ id: "local-user", scopes: ["app:local"] });
    const named = await (await fetch(`${base}/api/app/actor`, { headers: { "x-app-user": "alice" } })).json();
    expect(named.actor).toEqual({ id: "local-user", scopes: ["app:local"] });
  });

  it("leaves unmatched paths untouched for the host router", async () => {
    const outside = await fetch(`${base}/api/other`);
    expect(outside.status).toBe(404);
    expect((await outside.json()).code).toBe("RouteNotFound");
  });

  it("rejects a malformed JSON body with a structured error", async () => {
    const malformed = await fetch(`${base}/api/app/cases/demo/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).code).toBe("InvalidJson");
  });
});
