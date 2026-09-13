import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { AiricRuntime, ModuleRegistry } from "@airic/framework";
import { MemoryModuleSource, MemoryRuntimeStore } from "@airic/testing";
import { PiHarness } from "../src/index.js";

const real = process.env.AIRIC_REAL_PI_SMOKE === "1";
(real ? it : it.skip)("streams one read-only real Pi turn without a business Domain", async () => {
  const provider = process.env.AIRIC_PROVIDER;
  const model = process.env.AIRIC_MODEL;
  const key = process.env.AIRIC_API_KEY;
  const projectRoot = process.env.AIRIC_SMOKE_PROJECT_ROOT;
  if (!provider || !model || !key || !projectRoot) throw new Error("Real Pi smoke requires provider, model, API key and AIRIC_SMOKE_PROJECT_ROOT");
  const source = new MemoryModuleSource(
    { smoke: { manifest: { schemaVersion: 1, id: "smoke", title: "Smoke", workTypes: [{ id: "read-only", path: "operating/read-only" }] } } },
    { "smoke/read-only": { manifest: { schemaVersion: 1, id: "read-only", title: "Read-only smoke", capabilities: { allowed: [] }, documents: [{ id: "process", path: "process.md", title: "Method", role: "process", load: "required" }], completion: { requiredCapabilities: [] } }, documents: { "process.md": "This is a read-only connectivity check. Do not call tools or change files. Reply AIRIC_PI_SMOKE_OK." } } },
  );
  const modules = new ModuleRegistry(source);
  await modules.load();
  const harness = new PiHarness({ cwd: resolve(projectRoot), sessionDirectory: await mkdtemp(resolve(tmpdir(), "airic-real-pi-smoke-")), model: { provider, id: model },
    ...(process.env.AIRIC_MODELS_PATH ? { modelsPath: resolve(projectRoot, process.env.AIRIC_MODELS_PATH) } : {}),
    ...(process.env.AIRIC_API_ENDPOINT ? { endpoint: process.env.AIRIC_API_ENDPOINT } : {}),
    apiKeys: { [provider]: key },
  });
  const runtime = new AiricRuntime({ modules, harness, store: new MemoryRuntimeStore() });
  await runtime.open();
  let deltas = 0;
  const off = runtime.subscribeLive((event) => { if (event.type === "text-delta") deltas += 1; });
  try {
    const work = await runtime.createWork({ moduleId: "smoke", workTypeId: "read-only", objective: "Read-only Pi connection check" }, { id: "smoke-operator", scopes: [] });
    const result = await runtime.sendMessage(work.id, "Only reply AIRIC_PI_SMOKE_OK. Do not call tools.", { id: "smoke-operator", scopes: [] });
    expect(result.text).toContain("AIRIC_PI_SMOKE_OK");
    expect(deltas).toBeGreaterThan(0);
    expect(runtime.getTrace(work.id).some((event) => event.type === "message.agent")).toBe(true);
  } finally { off(); await runtime.close(); await harness.dispose(); }
}, 120_000);
