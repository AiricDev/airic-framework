import { createServer } from "node:http";
import { resolve } from "node:path";
import { AiricRuntime, ModuleRegistry } from "@airic/framework";
import { createAiricAcpGateway } from "@airic/acp";
import { PiHarness, readWorkspaceStatus } from "@airic/harness-pi";
import { createAiricHttpHandler, createStaticHandler, type AiricAccessPolicy } from "@airic/server";
import { DirectoryModuleSource, FileRuntimeStore } from "@airic/storage-files";
import { createAppHttpHandler, sendJson, type AppRoute } from "./app/application-handler.js";
import { resolveActor } from "./app/actor.js";
import { DemoHarness } from "./app/demo-harness.js";
import { loadServerModules } from "./app/server-modules.js";

const root = process.cwd();
const configuredData = resolve(process.env.AIRIC_DATA_DIR ?? resolve(root, ".airic"));
const data = configuredData.endsWith("/v2") ? configuredData : resolve(configuredData, "v2");
const source = new DirectoryModuleSource(resolve(root, "src/modules"), { gitRoot: root });
const modules = new ModuleRegistry(source);
await modules.load();
const installed = await loadServerModules({ root, data, registry: modules });
for (const item of installed) if (item.contribution?.domain) modules.registerDomain(item.contribution.domain);

const harness = process.env.AIRIC_HARNESS === "pi"
  ? new PiHarness({
      cwd: root, sessionDirectory: resolve(data, "harness/pi"),
      ...(process.env.AIRIC_MODELS_PATH ? { modelsPath: resolve(root, process.env.AIRIC_MODELS_PATH) } : {}),
      ...(process.env.AIRIC_API_ENDPOINT ? { endpoint: process.env.AIRIC_API_ENDPOINT } : {}),
      ...(process.env.AIRIC_PROVIDER && process.env.AIRIC_API_KEY ? { apiKeys: { [process.env.AIRIC_PROVIDER]: process.env.AIRIC_API_KEY } } : {}),
      ...(process.env.AIRIC_PROVIDER && process.env.AIRIC_MODEL ? { model: { provider: process.env.AIRIC_PROVIDER, id: process.env.AIRIC_MODEL } } : {}),
      workspace: { root, grants: [{
        moduleId: "development", workTypeId: "module-smith",
        read: ["src/modules", "README.md", "AGENTS.md", "architecture-map.md"], write: ["src/modules"], denyWrite: ["src/modules/development"],
        target: { root: "src/modules", inputKey: "targetModuleId" },
        checks: [
          { id: "module_architecture", title: "module architecture", command: "pnpm", args: ["run", "architecture:check"], requiredChangeRoots: ["src/modules"] },
          { id: "module_types", title: "module types", command: "pnpm", args: ["run", "typecheck"], requiredChangeRoots: ["src/modules"] },
          { id: "module_tests", title: "module tests", command: "pnpm", args: ["test"], requiredChangeRoots: ["src/modules"] },
          { id: "module_browser", title: "module browser", command: "pnpm", args: ["run", "test:browser"], requiredChangeRoots: ["src/modules"] },
        ],
      }] },
    })
  : new DemoHarness();

// The scaffold's fixed loopback actor is development-only. Replace both authentication
// and this policy together before exposing an application to other users.
const authorize: AiricAccessPolicy = (actor, resource) => resource.kind !== "work" || Boolean(resource.work.createdBy && resource.work.createdBy === actor.id);
const runtime = new AiricRuntime({ store: new FileRuntimeStore({ directory: resolve(data, "runtime") }), harness, modules,
  authorizeWork: (actor, work) => authorize(actor, { kind: "work", work, action: "prompt" }),
});
await runtime.open();
const port = Number(process.env.PORT ?? 4173);
const acp = createAiricAcpGateway({ runtime, cwd: root, sessionDirectory: resolve(data, "acp/sessions"), origin: process.env.AIRIC_PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`, authenticate: resolveActor, authorize });

const routes: AppRoute[] = [{ method: "GET", path: "/health", handle: async () => ({ body: { ok: true } }) }, ...installed.flatMap((item) => item.contribution?.routes ?? [])];
const application = createAppHttpHandler({ routes, authenticate: resolveActor });
const airic = createAiricHttpHandler({
  runtime, basePath: "/api/airic", authenticate: resolveActor, authorize, agentConnection: acp.connection,
  workTypes: async () => Promise.all(modules.list().flatMap((module) => module.workTypes.map(async (workType) => { const loaded = await runtime.loadDefinition(module.id, workType.id); return { moduleId: module.id, workTypeId: workType.id, title: loaded.manifest.title, digest: loaded.digest }; }))),
  getWorkType: (moduleId, workTypeId) => { const resolved = modules.resolve({ moduleId, workTypeId }); return source.exportFiles({ moduleId, workTypeId, packagePath: resolved.packagePath }); },
  workspaceStatus: () => readWorkspaceStatus(root),
});
const files = createStaticHandler({ directory: resolve(root, "dist/public") });
const server = createServer(async (request, response) => {
  try { if (await application.handle(request, response)) return; if (await airic.handle(request, response)) return; if (await files.handle(request, response)) return; sendJson(response, 404, { error: "Not found", code: "RouteNotFound" }); }
  catch (error) { if (!response.headersSent) sendJson(response, 500, { error: error instanceof Error ? error.message : String(error), code: "RequestFailed" }); else response.end(); }
});
server.on("upgrade", (request, socket, head) => { void acp.handleUpgrade(request, socket, head).then((handled) => { if (!handled) socket.destroy(); }).catch(() => socket.destroy()); });
await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolveListen(); }); });
console.log(`Airic app: http://127.0.0.1:${port} (${process.env.AIRIC_HARNESS === "pi" ? "Pi" : "simulated"} harness)`);

async function shutdown() {
  await airic.close(); await acp.close(); await new Promise<void>((resolveClose) => server.close(() => resolveClose())); await runtime.close();
  for (const item of [...installed].reverse()) await item.contribution?.close?.();
  if (harness instanceof PiHarness) await harness.dispose();
}
process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
