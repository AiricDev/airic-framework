import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { AiricRuntime, ModuleRegistry } from "@airic/framework";
import { MemoryModuleSource, MemoryOperatingModelRepository, MemoryRuntimeStore } from "@airic/testing";
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
  const runtime = new AiricRuntime({ modules, harness, store: new MemoryRuntimeStore(), operatingModels: new MemoryOperatingModelRepository(source.definitions) });
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

(real ? it : it.skip)("edits and checks only a controlled temporary report module with real Pi", async () => {
  const provider = process.env.AIRIC_PROVIDER;
  const model = process.env.AIRIC_MODEL;
  const key = process.env.AIRIC_API_KEY;
  const projectRoot = process.env.AIRIC_SMOKE_PROJECT_ROOT;
  if (!provider || !model || !key || !projectRoot) throw new Error("Real Pi workspace smoke requires the configured provider and project root");
  const scratch = await mkdtemp(resolve(tmpdir(), "airic-pi-module-smoke-"));
  await mkdir(resolve(scratch, "src/modules"), { recursive: true });
  const source = new MemoryModuleSource(
    { "report-types": { manifest: { schemaVersion: 1, id: "report-types", title: "Report types", workTypes: [{ id: "report-type-maintenance", path: "operating/report-type-maintenance" }] } } },
    { "report-types/report-type-maintenance": { manifest: { schemaVersion: 1, id: "report-type-maintenance", title: "Temporary module file smoke", capabilities: { allowed: [] }, documents: [{ id: "process", path: "process.md", title: "Method", role: "process", load: "required" }], completion: { requiredCapabilities: [], requiredTools: ["workspace_check_smoke", "workspace_changes"] } }, documents: { "process.md": "This is a temporary test project. Use workspace_write to create src/modules/smoke-report/operating/process.md containing exactly AIRIC_PI_FILE_SMOKE_OK and a newline. Then call workspace_check_smoke and workspace_changes. Do not edit any other file." } } },
  );
  const modules = new ModuleRegistry(source); await modules.load();
  const harness = new PiHarness({ cwd: scratch, sessionDirectory: resolve(scratch, ".sessions"), model: { provider, id: model },
    ...(process.env.AIRIC_MODELS_PATH ? { modelsPath: resolve(projectRoot, process.env.AIRIC_MODELS_PATH) } : {}),
    ...(process.env.AIRIC_API_ENDPOINT ? { endpoint: process.env.AIRIC_API_ENDPOINT } : {}),
    apiKeys: { [provider]: key },
    workspace: { root: scratch, grants: [{ moduleId: "report-types", workTypeId: "report-type-maintenance", read: ["src/modules"], write: ["src/modules"], target: { root: "src/modules", inputKey: "targetModuleId" }, checks: [{ id: "smoke", title: "temporary file content", command: process.execPath, args: ["-e", "const fs=require('fs');if(fs.readFileSync('src/modules/smoke-report/operating/process.md','utf8')!=='AIRIC_PI_FILE_SMOKE_OK\\n')process.exit(1)"], requiredChangeRoots: ["src/modules/smoke-report"] }] }] },
  });
  const runtime = new AiricRuntime({ modules, harness, store: new MemoryRuntimeStore(), operatingModels: new MemoryOperatingModelRepository(source.definitions) }); await runtime.open();
  try {
    const work = await runtime.createWork({ moduleId: "report-types", workTypeId: "report-type-maintenance", objective: "Create one controlled smoke file and validate it", input: { targetModuleId: "smoke-report" } }, { id: "smoke-operator", scopes: [] });
    await runtime.sendMessage(work.id, "Follow the process exactly: write the temporary file, run workspace_check_smoke, then workspace_changes. Do not stop after text.", { id: "smoke-operator", scopes: [] });
    expect(await readFile(resolve(scratch, "src/modules/smoke-report/operating/process.md"), "utf8")).toBe("AIRIC_PI_FILE_SMOKE_OK\n");
    const trace = runtime.getTrace(work.id);
    expect(trace.some((event) => JSON.stringify(event.payload).includes("workspace_check_smoke"))).toBe(true);
    expect(trace.some((event) => JSON.stringify(event.payload).includes("workspace_changes"))).toBe(true);
    if (runtime.getWork(work.id)?.status === "open") await runtime.completeWork(work.id, { type: "temporary-smoke" });
    expect(runtime.getWork(work.id)?.status).toBe("completed");
  } finally { await runtime.close(); await harness.dispose(); }
}, 120_000);
