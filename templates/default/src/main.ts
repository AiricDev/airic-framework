import { createServer } from "node:http";
import { resolve } from "node:path";
import { AiricRuntime } from "@airic/framework";
import { PiHarness, readWorkspaceStatus } from "@airic/harness-pi";
import { createAiricHttpHandler, createStaticHandler } from "@airic/server";
import { DirectoryDefinitionSource, FileRuntimeStore } from "@airic/storage-files";
import { createApplicationAssembly } from "./integration/application.js";
import { DemoHarness } from "./integration/airic/demo-harness.js";
import { createAppHttpHandler, sendJson } from "./http/application-handler.js";
import { resolveActor } from "./http/actor.js";

const root = process.cwd();
const data = resolve(process.env.AIRIC_DATA_DIR ?? resolve(root, ".airic/data"));
const applicationAssembly = await createApplicationAssembly({ root, data });
const definitions = new DirectoryDefinitionSource(resolve(root, "work-definitions"), { gitRoot: root });
const harness = process.env.AIRIC_HARNESS === "pi"
  ? new PiHarness({
      cwd: root,
      sessionDirectory: resolve(data, "harness/pi"),
      ...(process.env.AIRIC_MODELS_PATH ? { modelsPath: resolve(root, process.env.AIRIC_MODELS_PATH) } : {}),
      ...(process.env.AIRIC_API_ENDPOINT ? { endpoint: process.env.AIRIC_API_ENDPOINT } : {}),
      ...(process.env.AIRIC_PROVIDER && process.env.AIRIC_API_KEY ? { apiKeys: { [process.env.AIRIC_PROVIDER]: process.env.AIRIC_API_KEY } } : {}),
      ...(process.env.AIRIC_PROVIDER && process.env.AIRIC_MODEL ? { model: { provider: process.env.AIRIC_PROVIDER, id: process.env.AIRIC_MODEL } } : {}),
      workspace: {
        root,
        grants: [
          { definitionId: "domain-model-smith", read: ["src/domain", "test/domain", "work-definitions", "README.md", "AGENTS.md"], write: ["src/domain", "test/domain"], checks: [{ id: "domain_tests", title: "domain tests", command: "pnpm", args: ["test"], requiredChangeRoots: ["test/domain"] }] },
          { definitionId: "operating-model-smith", read: ["work-definitions", "src/domain", "test/domain", "README.md", "AGENTS.md"], write: ["work-definitions"], denyWrite: ["work-definitions/domain-model-smith", "work-definitions/operating-model-smith", "work-definitions/experience-smith", "work-definitions/reflection"], checks: [{ id: "operating_model", title: "operating model validation", command: "pnpm", args: ["test"], requiredChangeRoots: ["work-definitions"] }] },
          { definitionId: "experience-smith", read: ["src", "test", "e2e", "work-definitions", "README.md", "AGENTS.md", "package.json", "tsconfig.json", "vite.config.ts", "playwright.config.ts"], write: ["src/application", "src/http", "src/integration", "src/ui", "test/application", "test/http", "test/ui", "e2e"], checks: [{ id: "application", title: "application checks", command: "pnpm", args: ["test"], requiredChangeRoots: ["test/application", "test/http"] }, { id: "browser", title: "browser checks", command: "pnpm", args: ["run", "test:browser"], requiredChangeRoots: ["test/ui", "e2e"] }] },
        ],
      },
    })
  : new DemoHarness();
const runtime = new AiricRuntime({
  store: new FileRuntimeStore({ directory: resolve(data, "runtime") }),
  harness,
  definitions,
});
for (const domain of applicationAssembly.domains) runtime.registerDomain(domain);
await runtime.open();

const application = createAppHttpHandler({ routes: applicationAssembly.routes, authenticate: resolveActor });
const airic = createAiricHttpHandler({
  runtime,
  basePath: "/api/airic",
  authenticate: resolveActor,
  definitions: () => definitions.list(),
  getDefinition: (id) => definitions.exportFiles(id),
  workspaceStatus: () => readWorkspaceStatus(root),
});
const files = createStaticHandler({ directory: resolve(root, "dist/public") });
const server = createServer(async (request, response) => {
  try {
    if (await application.handle(request, response)) return;
    if (await airic.handle(request, response)) return;
    if (await files.handle(request, response)) return;
    sendJson(response, 404, { error: "Not found", code: "RouteNotFound" });
  } catch (error) {
    if (!response.headersSent) sendJson(response, 500, { error: error instanceof Error ? error.message : String(error), code: "RequestFailed" });
    else response.end();
  }
});
const port = Number(process.env.PORT ?? 4173);
await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolveListen(); }); });
console.log(`Airic app: http://127.0.0.1:${port} (${process.env.AIRIC_HARNESS === "pi" ? "Pi" : "simulated"} harness)`);

async function shutdown() {
  await airic.close();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  await runtime.close();
  if (harness instanceof PiHarness) await harness.dispose();
}
process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
