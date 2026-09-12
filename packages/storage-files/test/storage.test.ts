import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DirectoryModuleSource, FileRuntimeStore } from "@airic/storage-files";
import { loadWorkDefinition } from "@airic/framework";
import type { RuntimeEvent } from "@airic/framework";

const event: RuntimeEvent = { kind: "trace.appended", event: { schemaVersion: 1, eventId: "e1", workId: "w1", type: "work.test", timestamp: "2026-01-01T00:00:00Z", actor: "test", payload: {} } };

describe("FileRuntimeStore", () => {
  it("rejects a second writer and rebuilds from the immutable journal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airic-store-"));
    const first = new FileRuntimeStore({ directory }); await first.open(); await first.append([event]);
    const second = new FileRuntimeStore({ directory }); await expect(second.open()).rejects.toThrow("already locked");
    await first.close(); await second.open();
    const replayed = []; for await (const item of second.replay()) replayed.push(item);
    expect(replayed).toEqual([event]); expect((await second.verify()).commits).toBe(1); await second.close();
  });

  it("ignores an interrupted temporary write", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airic-store-"));
    const store = new FileRuntimeStore({ directory, fault: (point) => { if (point === "before-rename") throw new Error("power loss"); } });
    await store.open(); await expect(store.append([event])).rejects.toThrow("power loss"); await store.close();
    const recovered = new FileRuntimeStore({ directory }); await recovered.open();
    const replayed = []; for await (const item of recovered.replay()) replayed.push(item);
    expect(replayed).toEqual([]); expect((await readdir(join(directory, "journal"))).some((name) => name.endsWith(".tmp"))).toBe(true); await recovered.close();
  });

  it("recovers a durable commit when the response is lost after rename", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airic-store-"));
    const store = new FileRuntimeStore({ directory, fault: (point) => { if (point === "after-rename") throw new Error("response lost"); } });
    await store.open(); await expect(store.append([event])).rejects.toThrow("response lost"); await store.close();
    const recovered = new FileRuntimeStore({ directory }); await recovered.open();
    const replayed = []; for await (const item of recovered.replay()) replayed.push(item);
    expect(replayed).toEqual([event]); await recovered.close();
  });

  it("hashes the JSON representation when trace payloads contain undefined fields", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airic-store-"));
    const withUndefined = {
      kind: "trace.appended",
      event: { ...event.event, eventId: "e-undefined", payload: { hook: "context", providerEventId: undefined } },
    } as RuntimeEvent;
    const store = new FileRuntimeStore({ directory }); await store.open(); await store.append([withUndefined]); await store.close();
    const recovered = new FileRuntimeStore({ directory }); await recovered.open();
    const replayed = []; for await (const item of recovered.replay()) replayed.push(item);
    expect(replayed).toEqual([{ ...withUndefined, event: { ...withUndefined.event, payload: { hook: "context" } } }]);
    await recovered.close();
  });

  it("reads module-owned WorkTypes directly from the current project directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airic-modules-"));
    const moduleRoot = join(directory, "modules", "example"); const root = join(moduleRoot, "operating", "assist"); await mkdir(root, { recursive: true });
    await writeFile(join(moduleRoot, "module.yml"), "schemaVersion: 1\nid: example\ntitle: Example\nworkTypes:\n  - id: assist\n    path: operating/assist\n");
    await writeFile(join(root, "work.yml"), "schemaVersion: 1\nid: assist\ntitle: Assist\ncapabilities:\n  allowed: []\ndocuments:\n  - id: process\n    path: process.md\n    title: Process\n    role: process\n    load: required\ncompletion:\n  requiredCapabilities: []\n");
    await writeFile(join(root, "process.md"), "First content");
    const definitions = new DirectoryModuleSource(join(directory, "modules"), { gitRoot: directory });
    const ref = { moduleId: "example", workTypeId: "assist", packagePath: "operating/assist" };
    const first = await loadWorkDefinition(definitions, ref);
    await writeFile(join(root, "process.md"), "Second content");
    const second = await loadWorkDefinition(definitions, ref);
    expect(second.digest).not.toBe(first.digest);
    expect(second.required[0]?.content).toBe("Second content");
  });

  it("rebuilds a disposable snapshot anchored to the journal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airic-snapshot-"));
    const store = new FileRuntimeStore({ directory }); await store.open(); await store.append([event]);
    const snapshot = await store.rebuildSnapshot({ count: 0 }, (state) => ({ count: state.count + 1 }));
    expect(snapshot.state.count).toBe(1);
    expect((await store.readLatestSnapshot<{ count: number }>())?.state.count).toBe(1);
    await store.close();
  });
});
