import { resolve } from "node:path";
import { AiricRuntime } from "@airic/framework";
import { PiHarness, readWorkspaceStatus } from "@airic/harness-pi";
import { createAiricServer } from "@airic/server";
import { DirectoryDefinitionSource, FileRuntimeStore } from "@airic/storage-files";
import { createCaseDomain } from "./adapters/domain-module.js";
import { DemoHarness } from "./adapters/demo-harness.js";
import { JsonCaseRepository } from "./adapters/json-case-repository.js";

const root = process.cwd();
const data = resolve(process.env.AIRIC_DATA_DIR ?? resolve(root, ".airic/data"));
const repository = new JsonCaseRepository(resolve(data, "business/cases.json"));
await repository.initialize();
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
          { definitionId: "domain-model-smith", write: ["src/domain", "test/domain"], checks: [{ id: "domain_tests", title: "domain tests", command: "npm", args: ["test"] }] },
          { definitionId: "operating-model-smith", write: ["work-definitions"], denyWrite: ["work-definitions/domain-model-smith", "work-definitions/operating-model-smith", "work-definitions/reflection"], checks: [{ id: "operating_model", title: "operating model validation", command: "npm", args: ["test"] }] },
        ],
      },
    })
  : new DemoHarness();
const runtime = new AiricRuntime({
  store: new FileRuntimeStore({ directory: resolve(data, "runtime") }),
  harness,
  definitions,
});
runtime.registerDomain(createCaseDomain(repository, root));
await runtime.open();
const app = createAiricServer({
  runtime,
  port: Number(process.env.PORT ?? 4173),
  staticDirectory: resolve(root, "dist/public"),
  definitions: () => definitions.list(),
  getDefinition: (id) => definitions.exportFiles(id),
  workspaceStatus: () => readWorkspaceStatus(root),
});
const address = await app.listen();
console.log(`Airic workbench: http://${address.host}:${address.port} (${process.env.AIRIC_HARNESS === "pi" ? "Pi" : "simulated"} harness)`);

async function shutdown() {
  await app.close();
  await runtime.close();
  if (harness instanceof PiHarness) await harness.dispose();
}
process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
