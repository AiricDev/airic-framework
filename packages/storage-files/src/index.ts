import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, normalize, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { parseTarget, rejected, sameRef, snapshotKey, targetKey, type ModuleSource, type OperatingModelAdoption, type OperatingModelId, type OperatingModelOperation, type OperatingModelProposal, type OperatingModelReview, type OperatingModelSnapshot, type OperatingModelStorePort, type OperatingModelRevisionRef, type RuntimeEvent, type RuntimeStore, type WorkTypeRef } from "@airic/framework";

interface CommitBody {
  format: "airic-journal-v2";
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
      const body: CommitBody = { format: "airic-journal-v2", sequence: this.#sequence + 1, previousHash: this.#previousHash, timestamp: this.#now().toISOString(), events };
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
    const body = { format: "airic-snapshot-v2" as const, sequence: this.#sequence, journalHash: this.#previousHash, state };
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
    if (snapshot.format !== "airic-snapshot-v2" || digest(stable(body)) !== hash || !name.endsWith(`${hash}.json`)) throw new Error(`Snapshot hash mismatch: ${name}`);
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
      if (commit.format !== "airic-journal-v2" || commit.sequence !== expectedSequence || commit.previousHash !== previousHash) throw new Error(`Incompatible or broken Airic runtime journal at ${name}; version 0.2 requires a new storage directory`);
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

/** Filesystem discovery only. Operating Model reads are deliberately delegated to a repository. */
export class DirectoryModuleSource implements ModuleSource {
  readonly #root: string;
  readonly #gitRoot: string;
  constructor(root: string, options: { gitRoot?: string } = {}) { this.#root = resolve(root); this.#gitRoot = resolve(options.gitRoot ?? resolve(root, "..")); }
  async listModules(): Promise<readonly string[]> { return (await readdir(this.#root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(entry.name)).map((entry) => entry.name).sort(); }
  async readModuleManifest(moduleId: string): Promise<string> { return readFile(await this.#modulePath(moduleId, "module.yml"), "utf8"); }
  async readManifest(ref: WorkTypeRef & { packagePath: string }): Promise<string> { return readFile(await this.#workTypePath(ref, "work.yml"), "utf8"); }
  async readDocument(ref: WorkTypeRef & { packagePath: string }, path: string): Promise<string> { return readFile(await this.#workTypePath(ref, path), "utf8"); }
  async listWorkTypeFiles(ref: WorkTypeRef & { packagePath: string }): Promise<readonly string[]> { return walkFiles(await this.#workTypePath(ref, "."), true); }
  async exportFiles(ref: WorkTypeRef & { packagePath: string }): Promise<{ digest: string; files: Record<string, string> }> {
    const files: Record<string, string> = {};
    for (const path of await this.listWorkTypeFiles(ref)) files[path] = await this.readDocument(ref, path);
    return { digest: digest(stable(files)), files };
  }
  async status(): Promise<{ gitHead?: string; dirty: boolean }> {
    const run = promisify(execFile);
    try {
      const [{ stdout: head }, { stdout: changes }] = await Promise.all([
        run("git", ["rev-parse", "HEAD"], { cwd: this.#gitRoot }),
        run("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: this.#gitRoot }),
      ]);
      return { gitHead: head.trim(), dirty: Boolean(changes.trim()) };
    } catch { return { dirty: true }; }
  }
  async #modulePath(moduleId: string, path: string): Promise<string> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(moduleId)) throw new Error("Unsafe module id");
    const base = resolve(this.#root, moduleId);
    const resolved = resolve(base, normalize(path));
    if (resolved !== base && !resolved.startsWith(`${base}${sep}`)) throw new Error("Work Definition path escapes its directory");
    await rejectSymbolicPath(base, resolved);
    return resolved;
  }
  async #workTypePath(ref: WorkTypeRef & { packagePath: string }, path: string): Promise<string> {
    const base = await this.#modulePath(ref.moduleId, ref.packagePath);
    const resolved = resolve(base, normalize(path));
    if (resolved !== base && !resolved.startsWith(`${base}${sep}`)) throw new Error("WorkType path escapes its package");
    await rejectSymbolicPath(base, resolved);
    return resolved;
  }
}

/**
 * A repository backed by private Git refs.  The checked-out project is never
 * read as the active model and is never written during proposal or adoption.
 * Git object IDs are intentionally absent from the public Framework contract.
 */
export class GitOperatingModelRepository implements OperatingModelStorePort {
  readonly #root: string; readonly #ref = "refs/airic/operating-model/state";
  #ready: Promise<void> | undefined;
  constructor(root: string) { this.#root = resolve(root); }

  async bootstrap(snapshot: OperatingModelSnapshot, operationId = `baseline:${snapshot.target.moduleId}:${snapshot.target.workTypeId}:${snapshot.ref.contentDigest}`): Promise<OperatingModelRevisionRef> {
    const loaded = await this.#state(); const key = targetKey(snapshot.target);
    if (loaded.state.active[key]) return loaded.state.active[key]!;
    const state = structuredClone(loaded.state); state.snapshots[snapshotKey(snapshot.target, snapshot.ref)] = snapshot; state.active[key] = snapshot.ref;
    await this.#write(state, loaded.oid, operationId); return snapshot.ref;
  }
  async resolveActive(target: OperatingModelId): Promise<OperatingModelRevisionRef> { const value = (await this.#state()).state.active[targetKey(target)]; if (!value) throw new Error("OperatingModelNotFound"); return value; }
  async readRevision(target: OperatingModelId, ref: OperatingModelRevisionRef): Promise<OperatingModelSnapshot> { const value = (await this.#state()).state.snapshots[snapshotKey(target, ref)]; if (!value) throw new Error("RevisionNotFound"); return value; }
  async listAvailableModels(): Promise<readonly OperatingModelId[]> { return Object.keys((await this.#state()).state.active).map(parseTarget); }
  async listRevisions(target: OperatingModelId): Promise<readonly OperatingModelRevisionRef[]> { const state = (await this.#state()).state; return Object.values(state.snapshots).filter((snapshot) => targetKey(snapshot.target) === targetKey(target)).map((snapshot) => snapshot.ref).sort((left, right) => left.revisionId.localeCompare(right.revisionId)); }
  async putProposal(input: Parameters<OperatingModelStorePort["putProposal"]>[0]): Promise<OperatingModelOperation> {
    const loaded = await this.#state(); const existing = loaded.state.operations[input.operationId]; if (existing) return existing;
    const active = loaded.state.active[targetKey(input.proposal.target)];
    if (!active || !sameRef(active, input.proposal.baseRevision)) return this.#reject(loaded, input.operationId, "BaseRevisionConflict", "Proposal base is not active");
    const state = structuredClone(loaded.state); state.snapshots[snapshotKey(input.candidate.target, input.candidate.ref)] = input.candidate; state.proposals[input.proposal.proposalId] = input.proposal;
    return this.#commit(loaded, state, input.operationId, input.proposal);
  }
  async getProposal(proposalId: string): Promise<OperatingModelProposal | undefined> { const state = (await this.#state()).state; const proposal = state.proposals[proposalId]; return proposal && this.#proposalView(state, proposal); }
  async getCandidate(proposalId: string): Promise<OperatingModelSnapshot | undefined> { const proposal = await this.getProposal(proposalId); return proposal ? this.readRevision(proposal.target, proposal.candidateRevision) : undefined; }
  async listProposals(target?: OperatingModelId): Promise<readonly OperatingModelProposal[]> { const state = (await this.#state()).state; return Object.values(state.proposals).map((proposal) => this.#proposalView(state, proposal)).filter((item) => !target || targetKey(item.target) === targetKey(target)); }
  async getReview(proposalId: string): Promise<OperatingModelReview | undefined> { const state = (await this.#state()).state; return Object.values(state.reviews).find((review) => review.proposalId === proposalId); }
  async putReview(input: Parameters<OperatingModelStorePort["putReview"]>[0]): Promise<OperatingModelOperation> {
    const loaded = await this.#state(); const existing = loaded.state.operations[input.operationId]; if (existing) return existing; const proposal = loaded.state.proposals[input.review.proposalId];
    if (!proposal || this.#proposalView(loaded.state, proposal).status !== "open" || Object.values(loaded.state.reviews).some((review) => review.proposalId === proposal.proposalId)) return this.#reject(loaded, input.operationId, "ProposalStateConflict", "Proposal cannot be reviewed");
    const state = structuredClone(loaded.state); state.reviews[input.review.reviewId] = input.review; return this.#commit(loaded, state, input.operationId, input.review);
  }
  async adoptCandidate(input: Parameters<OperatingModelStorePort["adoptCandidate"]>[0]): Promise<OperatingModelOperation> {
    const loaded = await this.#state(); const existing = loaded.state.operations[input.operationId]; if (existing) return existing;
    const active = loaded.state.active[targetKey(input.proposal.target)];
    if (!active || !sameRef(active, input.expectedActiveRevision) || !sameRef(active, input.proposal.baseRevision)) return this.#reject(loaded, input.operationId, "BaseRevisionConflict", "The proposal base is no longer active");
    const candidate = loaded.state.snapshots[snapshotKey(input.proposal.target, input.proposal.candidateRevision)]; if (!candidate) return this.#reject(loaded, input.operationId, "RevisionNotFound", "Candidate revision is missing");
    const next: OperatingModelRevisionRef = { revisionId: `adopted:${candidate.ref.contentDigest.slice(0, 16)}`, contentDigest: candidate.ref.contentDigest };
    const state = structuredClone(loaded.state); state.snapshots[snapshotKey(input.proposal.target, next)] = { ...candidate, ref: next, parentRef: active }; state.active[targetKey(input.proposal.target)] = next;
    const adoption: OperatingModelAdoption = { adoptionId: `adoption:${input.operationId}`, proposalId: input.proposal.proposalId, previousActive: active, activeRevision: next, reviewBinding: { reviewId: input.review.reviewId, proposalDigest: input.review.proposalDigest, validationReceiptDigest: input.review.validationReceiptDigest } };
    return this.#commit(loaded, state, input.operationId, adoption);
  }
  async inspectOperation(operationId: string): Promise<OperatingModelOperation | undefined> { return (await this.#state()).state.operations[operationId]; }
  #proposalView(state: GitOperatingModelState, proposal: OperatingModelProposal): OperatingModelProposal { const review = Object.values(state.reviews).find((item) => item.proposalId === proposal.proposalId); const adopted = Object.values(state.operations).some((operation) => operation.status === "committed" && "adoptionId" in operation.result && operation.result.proposalId === proposal.proposalId); const active = state.active[targetKey(proposal.target)]; return { ...proposal, status: adopted ? "adopted" : !active || !sameRef(active, proposal.baseRevision) ? "stale" : review?.decision === "rejected" ? "rejected" : review?.decision === "approved" ? "approved" : "open" }; }
  async #commit(loaded: LoadedGitState, state: GitOperatingModelState, operationId: string, result: OperatingModelProposal | OperatingModelReview | OperatingModelAdoption): Promise<OperatingModelOperation> { const operation: OperatingModelOperation = { operationId, status: "committed", result }; state.operations[operationId] = operation; await this.#write(state, loaded.oid, operationId); return operation; }
  async #reject(loaded: LoadedGitState, operationId: string, code: string, message: string): Promise<OperatingModelOperation> { const operation: OperatingModelOperation = { operationId, status: "rejected", error: { code, message } }; const state = structuredClone(loaded.state); state.operations[operationId] = operation; await this.#write(state, loaded.oid, operationId); return operation; }
  async #state(): Promise<LoadedGitState> { await this.#ensureGit(); const run = promisify(execFile); let oid: string; try { oid = (await run("git", ["rev-parse", "--verify", this.#ref], { cwd: this.#root })).stdout.trim(); } catch { return { state: { snapshots: {}, active: {}, proposals: {}, reviews: {}, operations: {} } }; } const { stdout } = await run("git", ["show", `${oid}:state.json`], { cwd: this.#root }); return { oid, state: JSON.parse(stdout) as GitOperatingModelState }; }
  async #write(state: GitOperatingModelState, expectedOid: string | undefined, message: string): Promise<void> { await this.#ensureGit(); const run = promisify(execFile); const env = { ...process.env, GIT_AUTHOR_NAME: "Airic", GIT_AUTHOR_EMAIL: "airic@local", GIT_COMMITTER_NAME: "Airic", GIT_COMMITTER_EMAIL: "airic@local" }; const blob = await gitInput(this.#root, ["hash-object", "-w", "--stdin"], JSON.stringify(state), env); const tree = await gitInput(this.#root, ["mktree"], `100644 blob ${blob.trim()}\tstate.json\n`, env); const { stdout: commit } = await run("git", ["commit-tree", tree.trim(), "-m", `airic operating model ${message}`], { cwd: this.#root, env }); try { await run("git", expectedOid ? ["update-ref", this.#ref, commit.trim(), expectedOid] : ["update-ref", this.#ref, commit.trim(), "0000000000000000000000000000000000000000"], { cwd: this.#root, env }); } catch { throw new Error("BaseRevisionConflict"); } }
  async #ensureGit(): Promise<void> { this.#ready ??= (async () => { await mkdir(this.#root, { recursive: true }); const run = promisify(execFile); try { await run("git", ["rev-parse", "--git-dir"], { cwd: this.#root }); } catch { await run("git", ["init", "--bare"], { cwd: this.#root }); } })(); return this.#ready; }
}

interface GitOperatingModelState { snapshots: Record<string, OperatingModelSnapshot>; active: Record<string, OperatingModelRevisionRef>; proposals: Record<string, OperatingModelProposal>; reviews: Record<string, OperatingModelReview>; operations: Record<string, OperatingModelOperation> }
interface LoadedGitState { oid?: string; state: GitOperatingModelState }
function gitInput(cwd: string, args: readonly string[], input: string, env: NodeJS.ProcessEnv): Promise<string> { return new Promise((resolveInput, rejectInput) => { const child = spawn("git", [...args], { cwd, env, stdio: ["pipe", "pipe", "pipe"] }); let stdout = ""; let stderr = ""; child.stdout.on("data", (chunk) => { stdout += String(chunk); }); child.stderr.on("data", (chunk) => { stderr += String(chunk); }); child.on("error", rejectInput); child.on("close", (code) => code === 0 ? resolveInput(stdout) : rejectInput(new Error(stderr || `git exited ${code}`))); child.stdin.end(input); }); }

async function walkFiles(root: string, rejectLinks = false): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (rejectLinks && entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in Work Definitions: ${path}`);
    if (entry.isDirectory()) result.push(...(await walkFiles(path, rejectLinks)).map((child) => join(entry.name, child)));
    else result.push(relative(root, path));
  }
  return result.sort();
}
async function rejectSymbolicPath(root: string, target: string): Promise<void> { let current = root; for (const segment of relative(root, target).split(sep).filter(Boolean)) { current = resolve(current, segment); try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symbolic links are not allowed in Work Definitions: ${current}`); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; } } }
async function safeReadDir(path: string): Promise<string[]> { try { return await readdir(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; } }
async function syncDirectory(path: string): Promise<void> { const handle = await open(path, "r"); try { await handle.sync(); } finally { await handle.close(); } }
async function writeAtomic(path: string, content: string): Promise<void> { const temporary = `${path}.${randomUUID()}.tmp`; const handle = await open(temporary, "wx", 0o600); try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); } await rename(temporary, path); await syncDirectory(dirname(path)); }
function safeChild(root: string, path: string): string { const child = resolve(root, normalize(path)); if (child !== root && !child.startsWith(`${root}${sep}`)) throw new Error("Path escapes the allowed directory"); return child; }
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
