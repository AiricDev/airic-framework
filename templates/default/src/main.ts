import { resolve } from "node:path";
import { AiricRuntime } from "@airic/framework";
import { PiHarness } from "@airic/harness-pi";
import { createAiricServer } from "@airic/server";
import { FileRuntimeStore, VersionedDefinitionStore } from "@airic/storage-files";
import { createCaseDomain } from "./adapters/domain-module.js";
import { DemoHarness } from "./adapters/demo-harness.js";
import { JsonCaseRepository } from "./adapters/json-case-repository.js";

const root = process.cwd();
const data = resolve(process.env.AIRIC_DATA_DIR ?? resolve(root, ".airic/data"));
const repository = new JsonCaseRepository(resolve(data, "business/cases.json"));
await repository.initialize();
const definitions = new VersionedDefinitionStore(resolve(data, "definitions"));
await definitions.initializeFrom(resolve(root, "work-definitions"), ["case-assistance", "reflection"]);
const harness = process.env.AIRIC_HARNESS === "pi"
  ? new PiHarness({
      cwd: root,
      sessionDirectory: resolve(data, "harness/pi"),
      ...(process.env.AIRIC_MODELS_PATH ? { modelsPath: resolve(root, process.env.AIRIC_MODELS_PATH) } : {}),
      ...(process.env.AIRIC_API_ENDPOINT ? { endpoint: process.env.AIRIC_API_ENDPOINT } : {}),
      ...(process.env.AIRIC_PROVIDER && process.env.AIRIC_API_KEY ? { apiKeys: { [process.env.AIRIC_PROVIDER]: process.env.AIRIC_API_KEY } } : {}),
      ...(process.env.AIRIC_PROVIDER && process.env.AIRIC_MODEL ? { model: { provider: process.env.AIRIC_PROVIDER, id: process.env.AIRIC_MODEL } } : {}),
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
  publishDefinition: (input) => definitions.publish(input),
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
