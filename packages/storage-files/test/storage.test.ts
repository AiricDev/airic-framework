import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { DirectoryModuleSource, FileRuntimeStore, GitOperatingModelRepository } from "@airic/storage-files";
import { digest, loadWorkDefinition, OperatingModelService, stable } from "@airic/framework";
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
    const first = await loadWorkDefinition(await snapshotFromWorkingTree(definitions, ref));
    await writeFile(join(root, "process.md"), "Second content");
    const second = await loadWorkDefinition(await snapshotFromWorkingTree(definitions, ref));
    expect(second.digest).not.toBe(first.digest);
    expect(second.required[0]?.content).toBe("Second content");
  });

  it("keeps immutable Operating Model proposals and active revisions in private Git state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "airic-operating-model-"));
    const checkout = join(directory, "checkout"); await mkdir(checkout); const run = promisify(execFile); await run("git", ["init"], { cwd: checkout });
    const privateRepository = join(checkout, ".airic", "operating-model.git");
    const repository = new OperatingModelService(new GitOperatingModelRepository(privateRepository));
    const target = { moduleId: "example", workTypeId: "assist" };
    const workYml = "schemaVersion: 1\nid: assist\ntitle: Assist\ncapabilities:\n  allowed: []\ndocuments:\n  - id: process\n    path: process.md\n    title: Process\n    role: process\n    load: required\ncompletion:\n  requiredCapabilities: []\n";
    const files = [{ path: "work.yml", content: workYml, digest: digest(workYml) }, { path: "process.md", content: "Original", digest: digest("Original") }].sort((left, right) => left.path.localeCompare(right.path)); const contentDigest = digest(stable(files.map(({ path, content }) => ({ path, content }))));
    const baseline = { target, ref: { revisionId: "baseline:one", contentDigest }, files } as const;
    await repository.bootstrap(baseline);
    expect((await run("git", ["rev-parse", "--is-bare-repository"], { cwd: privateRepository })).stdout.trim()).toBe("true");
    await expect(run("git", ["show-ref", "--verify", "refs/airic/operating-model/state"], { cwd: checkout })).rejects.toThrow();
    const proposalResult = await repository.propose({ operationId: "proposal-1", target, baseRevision: baseline.ref, changeSet: { upsert: [{ path: "process.md", content: "Revised" }], delete: [] }, rationale: "Clearer", evidenceRefs: [], provenance: { trajectoryRevisions: [] }, proposer: { kind: "human", id: "u1" } });
    expect(proposalResult.status).toBe("committed");
    if (proposalResult.status !== "committed" || !("proposalId" in proposalResult.result)) throw new Error("proposal missing");
    const proposal = proposalResult.result;
    const reviewResult = await repository.review({ operationId: "review-1", proposalId: proposal.proposalId, proposalDigest: proposal.candidateDigest, validationReceiptDigest: proposal.validation.receiptDigest, decision: "approved", reviewer: "u2" });
    expect(reviewResult.status).toBe("committed");
    if (reviewResult.status !== "committed" || !("reviewId" in reviewResult.result)) throw new Error("review missing");
    const review = reviewResult.result;
    const adopted = await repository.adopt({ operationId: "adopt-1", proposalId: proposal.proposalId, proposalDigest: proposal.candidateDigest, reviewId: review.reviewId, reviewDigest: review.reviewDigest, expectedActiveRevision: baseline.ref, reviewer: "u2" });
    expect(adopted.status).toBe("committed");
    expect((await repository.readRevision(target, await repository.resolveActive(target))).files.find((file) => file.path === "process.md")?.content).toBe("Revised");
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

async function snapshotFromWorkingTree(source: DirectoryModuleSource, ref: { moduleId: string; workTypeId: string; packagePath: string }) {
  const exported = await source.exportFiles(ref); const files = Object.entries(exported.files).map(([path, content]) => ({ path, content, digest: digest(content) })); const contentDigest = digest(stable(files.map(({ path, content }) => ({ path, content }))));
  return { target: { moduleId: ref.moduleId, workTypeId: ref.workTypeId }, ref: { revisionId: `working:${contentDigest.slice(0, 12)}`, contentDigest }, files };
}
