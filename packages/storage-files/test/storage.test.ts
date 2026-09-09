import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileRuntimeStore, VersionedDefinitionStore } from "@airic/storage-files";
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

  it("publishes immutable Work Definition revisions and can reopen an old revision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airic-definitions-"));
    const definitions = new VersionedDefinitionStore(directory);
    const baseFiles = {
      "work.yml": "schemaVersion: 1\nid: assist\ntitle: Assist\ndocuments:\n  - id: process\n    path: process.md\n    title: Process\n    role: process\n    load: required\ncompletion:\n  requiredCapabilities: []\n",
      "process.md": "First version",
    };
    const first = await definitions.publish({ id: "assist", files: baseFiles });
    const second = await definitions.publish({ id: "assist", baseRevision: first.revision, files: { ...baseFiles, "process.md": "Second version" } });
    expect(second.revision).not.toBe(first.revision);
    expect(await definitions.readDocument("assist", "process.md", first.revision)).toBe("First version");
    expect(await definitions.readDocument("assist", "process.md")).toBe("Second version");
    await expect(definitions.publish({ id: "assist", baseRevision: first.revision, files: baseFiles })).rejects.toThrow("revision conflict");
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
