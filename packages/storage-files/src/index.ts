import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, normalize, relative, resolve, sep } from "node:path";
import { loadWorkDefinition, type DefinitionSource, type RuntimeEvent, type RuntimeStore } from "@airic/framework";

interface CommitBody {
  format: "airic-journal-v1";
  sequence: number;
  previousHash: string | null;
  timestamp: string;
  events: readonly RuntimeEvent[];
}
interface CommitFile extends CommitBody { hash: string }

export interface FileRuntimeStoreOptions {
  directory: string;
  now?: () => Date;
  fault?: (point: "after-temp-write" | "before-rename" | "after-rename") => void | Promise<void>;
}

export class FileRuntimeStore implements RuntimeStore {
  readonly #directory: string;
  readonly #now: () => Date;
  readonly #fault?: FileRuntimeStoreOptions["fault"];
  #lock: Awaited<ReturnType<typeof open>> | undefined;
  #lockToken: string | undefined;
  #sequence = 0;
  #previousHash: string | null = null;
  #writes: Promise<void> = Promise.resolve();

  constructor(options: FileRuntimeStoreOptions) {
    this.#directory = resolve(options.directory);
    this.#now = options.now ?? (() => new Date());
    this.#fault = options.fault;
  }

  async open(): Promise<void> {
    await mkdir(this.#journalDir(), { recursive: true });
    await mkdir(this.#objectsDir(), { recursive: true });
    const token = randomUUID();
    try {
      this.#lock = await open(this.#lockPath(), "wx", 0o600);
      this.#lockToken = token;
      await this.#lock.writeFile(JSON.stringify({ token, pid: process.pid, host: process.env.HOSTNAME ?? "unknown", acquiredAt: this.#now().toISOString() }));
      await this.#lock.sync();
    } catch (error) {
      throw new Error(`Airic runtime directory is already locked: ${this.#lockPath()}`, { cause: error });
    }
    for await (const commit of this.#commits()) {
      this.#sequence = commit.sequence;
      this.#previousHash = commit.hash;
    }
  }

  async close(): Promise<void> {
    await this.#writes;
    if (!this.#lock) return;
    await this.#lock.close();
    const lock = JSON.parse(await readFile(this.#lockPath(), "utf8")) as { token?: string };
    if (lock.token === this.#lockToken) await rm(this.#lockPath());
    this.#lock = undefined;
    this.#lockToken = undefined;
  }

  async append(events: readonly RuntimeEvent[]): Promise<void> {
    if (!events.length) return;
    if (!this.#lock) throw new Error("FileRuntimeStore is not open");
    const operation = this.#writes.then(async () => {
      const body: CommitBody = { format: "airic-journal-v1", sequence: this.#sequence + 1, previousHash: this.#previousHash, timestamp: this.#now().toISOString(), events };
      const hash = digest(stable(body));
      const commit: CommitFile = { ...body, hash };
      const finalPath = join(this.#journalDir(), `${String(body.sequence).padStart(12, "0")}-${hash}.json`);
      const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;
      const handle = await open(temporaryPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(commit)}\n`);
        await handle.sync();
      } finally { await handle.close(); }
      await this.#fault?.("after-temp-write");
      await this.#fault?.("before-rename");
      await rename(temporaryPath, finalPath);
      await syncDirectory(this.#journalDir());
      await this.#fault?.("after-rename");
      this.#sequence = body.sequence;
      this.#previousHash = hash;
    });
    this.#writes = operation.catch(() => undefined);
    return operation;
  }

  async *replay(): AsyncIterable<RuntimeEvent> {
    for await (const commit of this.#commits()) for (const event of commit.events) yield event;
  }

  async putObject(content: Uint8Array): Promise<{ digest: string; size: number }> {
    const hash = digest(content);
    const path = join(this.#objectsDir(), hash.slice(0, 2), hash.slice(2));
    await mkdir(dirname(path), { recursive: true });
    try {
      const handle = await open(path, "wx", 0o600);
      try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
      await syncDirectory(dirname(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return { digest: hash, size: content.byteLength };
  }

  async getObject(hash: string): Promise<Uint8Array> {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid object digest");
    const content = await readFile(join(this.#objectsDir(), hash.slice(0, 2), hash.slice(2)));
    if (digest(content) !== hash) throw new Error(`Object digest mismatch: ${hash}`);
    return content;
  }

  async rebuildSnapshot<T>(seed: T, project: (state: T, event: RuntimeEvent) => T): Promise<{ sequence: number; hash: string; state: T }> {
    let state = seed;
    for await (const event of this.replay()) state = project(state, event);
    const body = { format: "airic-snapshot-v1" as const, sequence: this.#sequence, journalHash: this.#previousHash, state };
    const hash = digest(stable(body));
    const directory = join(this.#directory, "snapshots"); await mkdir(directory, { recursive: true });
    await writeAtomic(join(directory, `${String(this.#sequence).padStart(12, "0")}-${hash}.json`), `${JSON.stringify({ ...body, hash })}\n`);
    return { sequence: this.#sequence, hash, state };
  }

  async readLatestSnapshot<T>(): Promise<{ sequence: number; hash: string; state: T } | undefined> {
    const directory = join(this.#directory, "snapshots");
    const name = (await safeReadDir(directory)).filter((item) => /^\d{12}-[a-f0-9]{64}\.json$/.test(item)).sort().at(-1);
    if (!name) return undefined;
    const snapshot = JSON.parse(await readFile(join(directory, name), "utf8")) as { format: string; sequence: number; journalHash: string | null; state: T; hash: string };
    const { hash, ...body } = snapshot;
    if (snapshot.format !== "airic-snapshot-v1" || digest(stable(body)) !== hash || !name.endsWith(`${hash}.json`)) throw new Error(`Snapshot hash mismatch: ${name}`);
    let matchingJournalHash: string | null = null;
    for await (const commit of this.#commits()) { if (commit.sequence === snapshot.sequence) matchingJournalHash = commit.hash; }
    if (matchingJournalHash !== snapshot.journalHash) throw new Error(`Snapshot journal anchor mismatch: ${name}`);
    return { sequence: snapshot.sequence, hash, state: snapshot.state };
  }

  async verify(): Promise<{ commits: number; lastHash: string | null; objects: number }> {
    let commits = 0; let lastHash: string | null = null;
    for await (const commit of this.#commits()) { commits += 1; lastHash = commit.hash; }
    let objects = 0;
    for (const prefix of await safeReadDir(this.#objectsDir())) objects += (await safeReadDir(join(this.#objectsDir(), prefix))).length;
    return { commits, lastHash, objects };
  }

  async backupTo(targetDirectory: string): Promise<void> {
    if (this.#lock) throw new Error("Close the runtime before taking a stop-write backup");
    const target = resolve(targetDirectory);
    if (target === this.#directory || target.startsWith(`${this.#directory}${sep}`)) throw new Error("Backup target must be outside the runtime directory");
    await cp(this.#directory, target, { recursive: true, errorOnExist: true, force: false });
  }

  static async inspectLock(directory: string): Promise<unknown | undefined> {
    try { return JSON.parse(await readFile(join(resolve(directory), "runtime.lock"), "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }

  static async breakLock(directory: string, expectedToken: string): Promise<void> {
    const path = join(resolve(directory), "runtime.lock");
    const lock = JSON.parse(await readFile(path, "utf8")) as { token?: string };
    if (!lock.token || lock.token !== expectedToken) throw new Error("Lock token changed; refusing recovery");
    await rm(path);
  }

  async *#commits(): AsyncIterable<CommitFile> {
    const names = (await readdir(this.#journalDir())).filter((name) => /^\d{12}-[a-f0-9]{64}\.json$/.test(name)).sort();
    let expectedSequence = 1;
    let previousHash: string | null = null;
    for (const name of names) {
      const commit = JSON.parse(await readFile(join(this.#journalDir(), name), "utf8")) as CommitFile;
      if (commit.format !== "airic-journal-v1" || commit.sequence !== expectedSequence || commit.previousHash !== previousHash) throw new Error(`Broken journal chain at ${name}`);
      const { hash, ...body } = commit;
      if (hash !== digest(stable(body)) || !name.endsWith(`${hash}.json`)) throw new Error(`Journal hash mismatch at ${name}`);
      yield commit;
      previousHash = hash;
      expectedSequence += 1;
    }
  }
  #journalDir(): string { return join(this.#directory, "journal"); }
  #objectsDir(): string { return join(this.#directory, "objects"); }
  #lockPath(): string { return join(this.#directory, "runtime.lock"); }
}

export class DirectoryDefinitionSource implements DefinitionSource {
  readonly #root: string;
  constructor(root: string) { this.#root = resolve(root); }
  async readManifest(definitionId: string): Promise<string> { return readFile(this.#path(definitionId, "work.yml"), "utf8"); }
  async readDocument(definitionId: string, path: string): Promise<string> { return readFile(this.#path(definitionId, path), "utf8"); }
  async listDefinitionFiles(definitionId: string): Promise<readonly string[]> { return walkFiles(this.#path(definitionId, ".")); }
  #path(definitionId: string, path: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(definitionId)) throw new Error("Unsafe definition id");
    const base = resolve(this.#root, definitionId);
    const resolved = resolve(base, normalize(path));
    if (resolved !== base && !resolved.startsWith(`${base}${sep}`)) throw new Error("Work Definition path escapes its directory");
    return resolved;
  }
}

export class VersionedDefinitionStore implements DefinitionSource {
  readonly #root: string;
  constructor(root: string) { this.#root = resolve(root); }

  async initializeFrom(seedRoot: string, definitionIds: readonly string[]): Promise<void> {
    await mkdir(this.#root, { recursive: true });
    const seed = new DirectoryDefinitionSource(seedRoot);
    for (const id of definitionIds) {
      try { await this.#current(id); continue; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const files: Record<string, string> = {};
      for (const path of await seed.listDefinitionFiles(id)) files[path] = await seed.readDocument(id, path);
      await this.publish({ id, files });
    }
  }

  async publish(input: { id: string; files: Readonly<Record<string, string>>; baseRevision?: string }): Promise<{ revision: string }> {
    this.#validateId(input.id);
    let current: string | undefined;
    try { current = await this.#current(input.id); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (input.baseRevision !== undefined && current !== input.baseRevision) throw new Error(`Definition revision conflict: expected ${input.baseRevision}, found ${current ?? "none"}`);
    const source: DefinitionSource = {
      readManifest: async () => input.files["work.yml"] ?? missing("work.yml"),
      readDocument: async (_id, path) => input.files[path] ?? missing(path),
      listDefinitionFiles: async () => Object.keys(input.files),
    };
    const definition = await loadWorkDefinition(source, input.id);
    const revisionDirectory = this.#revisionDirectory(input.id, definition.revision);
    try { await stat(revisionDirectory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      for (const [path, content] of Object.entries(input.files)) {
        const target = safeChild(revisionDirectory, path); await mkdir(dirname(target), { recursive: true }); await writeAtomic(target, content);
      }
      await syncDirectory(revisionDirectory);
    }
    const definitionDirectory = resolve(this.#root, input.id); await mkdir(definitionDirectory, { recursive: true });
    await writeAtomic(resolve(definitionDirectory, "current"), `${definition.revision}\n`);
    return { revision: definition.revision };
  }

  async list(): Promise<readonly { id: string; title: string; revision: string }[]> {
    const result = [];
    for (const id of await safeReadDir(this.#root)) {
      try { const revision = await this.#current(id); const manifest = YAML_PARSE(await this.readManifest(id, revision)) as { title?: string }; result.push({ id, title: manifest.title ?? id, revision }); } catch {}
    }
    return result;
  }

  async exportFiles(id: string, revision?: string): Promise<{ revision: string; files: Record<string, string> }> {
    const selected = revision ?? await this.#current(id); const files: Record<string, string> = {};
    for (const path of await this.listDefinitionFiles(id, selected)) files[path] = await this.readDocument(id, path, selected);
    return { revision: selected, files };
  }

  async readManifest(id: string, revision?: string): Promise<string> { return this.readDocument(id, "work.yml", revision); }
  async readDocument(id: string, path: string, revision?: string): Promise<string> { const selected = revision ?? await this.#current(id); return readFile(safeChild(this.#revisionDirectory(id, selected), path), "utf8"); }
  async listDefinitionFiles(id: string, revision?: string): Promise<readonly string[]> { const selected = revision ?? await this.#current(id); return walkFiles(this.#revisionDirectory(id, selected)); }
  async #current(id: string): Promise<string> { this.#validateId(id); return (await readFile(resolve(this.#root, id, "current"), "utf8")).trim(); }
  #revisionDirectory(id: string, revision: string): string { this.#validateId(id); if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error("Invalid definition revision"); return resolve(this.#root, id, "revisions", revision); }
  #validateId(id: string): void { if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new Error("Unsafe definition id"); }
}

async function walkFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await walkFiles(path)).map((child) => join(entry.name, child)));
    else result.push(relative(root, path));
  }
  return result.sort();
}
async function safeReadDir(path: string): Promise<string[]> { try { return await readdir(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; } }
async function syncDirectory(path: string): Promise<void> { const handle = await open(path, "r"); try { await handle.sync(); } finally { await handle.close(); } }
async function writeAtomic(path: string, content: string): Promise<void> { const temporary = `${path}.${randomUUID()}.tmp`; const handle = await open(temporary, "wx", 0o600); try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); } await rename(temporary, path); await syncDirectory(dirname(path)); }
function safeChild(root: string, path: string): string { const child = resolve(root, normalize(path)); if (child !== root && !child.startsWith(`${root}${sep}`)) throw new Error("Path escapes definition revision"); return child; }
function missing(path: string): never { throw new Error(`Missing definition file ${path}`); }
function YAML_PARSE(value: unknown): unknown { if (typeof value !== "string") return value; const match = value.match(/^title:\s*(.+)$/m); return { title: match?.[1]?.trim() }; }
function digest(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((child) => stable(child === undefined ? null : child)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
