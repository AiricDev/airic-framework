import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export interface WorkspaceCheck {
  id: string;
  title: string;
  command: string;
  args?: readonly string[];
  requiredChangeRoots?: readonly string[];
}

export interface WorkspaceGrant {
  moduleId: string;
  workTypeId: string;
  read: readonly string[];
  denyRead?: readonly string[];
  write: readonly string[];
  denyWrite?: readonly string[];
  checks?: readonly WorkspaceCheck[];
  target?: { root: string; inputKey: string };
}

export interface WorkspacePolicy {
  root: string;
  grants: readonly WorkspaceGrant[];
}

interface WorkspaceState {
  baseline: Record<string, string | null>;
  lastKnown: Record<string, string | null>;
  touched: string[];
}

const mutationQueues = new Map<string, Promise<void>>();
const secretNames = new Set([".env", "models.json", "models-store.json", "auth.json"]);
const ignoredSegments = new Set([".airic", ".git", "node_modules", "dist", "coverage", "playwright-report", "test-results"]);

export async function createWorkspaceTools(input: { policy: WorkspacePolicy; moduleId: string; workTypeId: string; workInput?: unknown; stateDirectory: string }): Promise<ToolDefinition[]> {
  const configuredGrant = input.policy.grants.find((candidate) => candidate.moduleId === input.moduleId && candidate.workTypeId === input.workTypeId);
  if (!configuredGrant) return [];
  const grant = scopedGrant(configuredGrant, input.workInput);
  const root = await realpath(resolve(input.policy.root));
  const statePath = resolve(input.stateDirectory, "workspace-state.json");
  await mkdir(input.stateDirectory, { recursive: true });
  let workspaceState = await readState(statePath);
  if (!workspaceState) {
    const baseline = await snapshot(root, grant);
    workspaceState = { baseline, lastKnown: { ...baseline }, touched: [] };
    await saveState(statePath, workspaceState);
  }
  const state = workspaceState;

  const readTool = defineTool({
    name: "workspace_read", label: "workspace_read", description: "Read a non-secret file inside the current project.",
    parameters: Type.Object({ path: Type.String() }),
    execute: async (_id, value) => result(await readFile(await safePath(root, value.path, "read", grant), "utf8")),
  });
  const listTool = defineTool({
    name: "workspace_list", label: "workspace_list", description: "List non-secret project files below a directory.",
    parameters: Type.Object({ path: Type.Optional(Type.String()), limit: Type.Optional(Type.Number()) }),
    execute: async (_id, value) => result((await listFiles(root, value.path ?? ".", value.limit ?? 200, grant)).join("\n")),
  });
  const searchTool = defineTool({
    name: "workspace_search", label: "workspace_search", description: "Search text in non-secret project files.",
    parameters: Type.Object({ query: Type.String(), path: Type.Optional(Type.String()), limit: Type.Optional(Type.Number()) }),
    execute: async (_id, value) => result((await searchFiles(root, value.query, value.path ?? ".", value.limit ?? 100, grant)).join("\n")),
  });
  const writeTool = defineTool({
    name: "workspace_write", label: "workspace_write", description: "Create or replace a file inside the write paths granted to this Work.",
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    execute: async (_id, value) => mutate(root, grant, state, statePath, value.path, async (path) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, value.content, "utf8"); return `Wrote ${value.path}`; }),
  });
  const editTool = defineTool({
    name: "workspace_edit", label: "workspace_edit", description: "Replace one exact, unique text block inside a file granted to this Work.",
    parameters: Type.Object({ path: Type.String(), oldText: Type.String(), newText: Type.String() }),
    execute: async (_id, value) => mutate(root, grant, state, statePath, value.path, async (path) => {
      const content = await readFile(path, "utf8");
      const first = content.indexOf(value.oldText);
      if (first < 0 || content.indexOf(value.oldText, first + value.oldText.length) >= 0) throw new Error("workspace_edit requires one unique oldText match");
      await writeFile(path, `${content.slice(0, first)}${value.newText}${content.slice(first + value.oldText.length)}`, "utf8");
      return `Edited ${value.path}`;
    }),
  });
  const statusTool = defineTool({
    name: "workspace_git_status", label: "workspace_git_status", description: "Show Git HEAD and working-tree status without changing Git state.",
    parameters: Type.Object({}), execute: async () => result(await gitStatus(root)),
  });
  const diffTool = defineTool({
    name: "workspace_git_diff", label: "workspace_git_diff", description: "Show the current Git diff without changing Git state.",
    parameters: Type.Object({ path: Type.Optional(Type.String()) }), execute: async (_id, value) => result(await gitDiff(root, value.path, grant)),
  });
  const changesTool = defineTool({
    name: "workspace_changes", label: "workspace_changes", description: "Return files changed since this Work first received workspace access.",
    parameters: Type.Object({}), execute: async () => {
      const changedFiles = await changes(root, grant, state, true);
      if (!changedFiles.length) throw new Error("WorkspaceChangeRequired: no files changed in this Work");
      return result(JSON.stringify(changedFiles, null, 2), { changes: changedFiles, changeSetDigest: digest(JSON.stringify(changedFiles)) });
    },
  });
  const checks = (grant.checks ?? []).map((check) => defineTool({
    name: checkToolName(check.id), label: checkToolName(check.id), description: `Run the host-approved check: ${check.title}.`, parameters: Type.Object({}),
    execute: async () => {
      const changedFiles = await changes(root, grant, state, true);
      if (check.requiredChangeRoots?.length && !changedFiles.some((change) => matchesAny(change.path, check.requiredChangeRoots!))) {
        throw new Error(`WorkspaceValidationMissingChanges: ${check.title} requires a change under ${check.requiredChangeRoots.join(", ")}`);
      }
      const run = promisify(execFile);
      const { stdout, stderr } = await run(check.command, [...(check.args ?? [])], { cwd: root, env: safeEnvironment(), maxBuffer: 4 * 1024 * 1024 });
      return result(`${stdout}${stderr}`.trim() || `${check.title} passed`, { check: { id: check.id, title: check.title, status: "passed" }, changes: changedFiles, changeSetDigest: digest(JSON.stringify(changedFiles)) });
    },
  }));
  return [readTool, listTool, searchTool, writeTool, editTool, statusTool, diffTool, changesTool, ...checks];
}

function scopedGrant(grant: WorkspaceGrant, workInput: unknown): WorkspaceGrant {
  if (!grant.target) return grant;
  if (!workInput || typeof workInput !== "object" || Array.isArray(workInput)) throw new Error(`WorkspaceTargetRequired: ${grant.target.inputKey}`);
  const value = (workInput as Record<string, unknown>)[grant.target.inputKey];
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(value)) throw new Error(`WorkspaceTargetInvalid: ${grant.target.inputKey}`);
  const targetRoot = `${grant.target.root.replace(/^\.\//u, "").replace(/\/$/u, "")}/${value}`;
  if (!matchesAny(targetRoot, grant.write) || matchesAny(targetRoot, grant.denyWrite ?? [])) throw new Error(`WorkspaceTargetDenied: ${targetRoot}`);
  const { target: _target, ...rest } = grant;
  return { ...rest, write: [targetRoot] };
}

export function checkToolName(id: string): string { return `workspace_check_${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`; }

export async function readWorkspaceStatus(root: string): Promise<{ gitHead?: string; dirty: boolean; status: string; diff: string }> {
  const resolved = await realpath(resolve(root));
  try {
    const statusText = await gitStatus(resolved);
    const head = statusText.match(/^HEAD ([a-f0-9]+)/u)?.[1];
    const short = statusText.split("\n").slice(1).join("\n");
    return { ...(head ? { gitHead: head } : {}), dirty: Boolean(short.trim()), status: short, diff: await gitDiff(resolved) };
  } catch { return { dirty: true, status: "Git status unavailable", diff: "" }; }
}

async function mutate(root: string, grant: WorkspaceGrant, state: WorkspaceState, statePath: string, requested: string, operation: (path: string) => Promise<string>) {
  return queue(root, async () => {
    const path = await safePath(root, requested, "write", grant);
    const key = relative(root, path).split(sep).join("/");
    const current = await fileDigest(path);
    const expected = Object.hasOwn(state.lastKnown, key) ? state.lastKnown[key] : null;
    if (current !== expected) throw new Error(`WorkspaceConflict: ${key} changed outside this Work`);
    const message = await operation(path);
    state.lastKnown[key] = await fileDigest(path);
    if (!state.touched.includes(key)) state.touched.push(key);
    await saveState(statePath, state);
    return result(message);
  });
}

async function safePath(root: string, requested: string, mode: "read" | "write", grant?: WorkspaceGrant): Promise<string> {
  if (!requested || requested.includes("\0")) throw new Error("Invalid workspace path");
  const target = resolve(root, requested);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("Workspace path escapes the project root");
  const rel = relative(root, target).split(sep).join("/");
  if (isSecret(rel)) throw new Error("Workspace path is private or generated");
  if (mode === "read") {
    if (!grant || !canRead(rel, grant)) throw new Error(`Workspace read is not granted for ${rel}`);
  } else {
    if (!grant || !matchesAny(rel, grant.write) || matchesAny(rel, grant.denyWrite ?? [])) throw new Error(`Workspace write is not granted for ${rel}`);
  }
  await rejectSymlinks(root, target);
  return target;
}

async function rejectSymlinks(root: string, target: string): Promise<void> {
  const rel = relative(root, target); let current = root;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symbolic links are not allowed in workspace paths: ${relative(root, current)}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  }
}

function isSecret(path: string): boolean {
  const segments = path.split("/");
  return segments.some((segment) => ignoredSegments.has(segment)) || segments.some((segment) => secretNames.has(segment) || segment.startsWith(".env.") || [".npmrc", ".pypirc", ".netrc"].includes(segment) || /(?:credential|secret)/iu.test(segment) || /\.(?:pem|key|p12|pfx)$/iu.test(segment));
}
function matchesAny(path: string, roots: readonly string[]): boolean { return roots.some((item) => { const normalized = item.replace(/^\.\//, "").replace(/\/$/, ""); return path === normalized || path.startsWith(`${normalized}/`); }); }
function canRead(path: string, grant: WorkspaceGrant): boolean { return !isSecret(path) && matchesAny(path, grant.read) && !matchesAny(path, grant.denyRead ?? []); }
function canTraverse(path: string, grant: WorkspaceGrant): boolean {
  if (!path) return true;
  return canRead(path, grant) || grant.read.some((item) => item.replace(/^\.\//, "").replace(/\/$/, "").startsWith(`${path}/`));
}
function digest(content: string | Buffer): string { return createHash("sha256").update(content).digest("hex"); }
async function fileDigest(path: string): Promise<string | null> { try { return digest(await readFile(path)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } }

async function listFiles(root: string, requested: string, limit: number, grant: WorkspaceGrant): Promise<string[]> {
  const start = requested === "." ? root : resolve(root, requested);
  const startRel = relative(root, start).split(sep).join("/");
  if ((start !== root && !start.startsWith(`${root}${sep}`)) || !canTraverse(startRel, grant)) throw new Error(`Workspace read is not granted for ${startRel || "."}`);
  await rejectSymlinks(root, start);
  const found: string[] = [];
  async function visit(path: string) {
    if (found.length >= limit) return;
    const info = await lstat(path);
    if (info.isSymbolicLink()) return;
    const rel = relative(root, path).split(sep).join("/");
    if (!info.isDirectory()) { if (canRead(rel, grant)) found.push(rel); return; }
    for (const name of (await readdir(path)).sort()) { const child = resolve(path, name); const childRel = relative(root, child).split(sep).join("/"); if (canTraverse(childRel, grant)) await visit(child); }
  }
  await visit(start); return found;
}

async function searchFiles(root: string, query: string, requested: string, limit: number, grant: WorkspaceGrant): Promise<string[]> {
  const output: string[] = [];
  for (const file of await listFiles(root, requested, 2000, grant)) {
    if (output.length >= limit) break;
    try { const content = await readFile(resolve(root, file), "utf8"); content.split(/\r?\n/u).forEach((line, index) => { if (output.length < limit && line.includes(query)) output.push(`${file}:${index + 1}:${line}`); }); } catch {}
  }
  return output;
}

async function snapshot(root: string, grant: WorkspaceGrant): Promise<Record<string, string | null>> {
  const value: Record<string, string | null> = {};
  const writeGrant: WorkspaceGrant = { ...grant, read: grant.write, ...(grant.denyWrite ? { denyRead: grant.denyWrite } : {}) };
  for (const writeRoot of grant.write) {
    try { for (const file of await listFiles(root, writeRoot, 5000, writeGrant)) if (!matchesAny(file, grant.denyWrite ?? [])) value[file] = await fileDigest(resolve(root, file)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return value;
}

async function changes(root: string, grant: WorkspaceGrant, state: WorkspaceState, authoredOnly = false) {
  const current = await snapshot(root, grant); const paths = new Set([...Object.keys(state.baseline), ...Object.keys(current)]);
  return [...paths].sort().flatMap((path) => (authoredOnly && !state.touched.includes(path)) || state.baseline[path] === current[path] ? [] : [{ path, status: state.baseline[path] == null ? "added" : current[path] == null ? "deleted" : "modified", beforeDigest: state.baseline[path] ?? null, afterDigest: current[path] ?? null }]);
}

async function gitStatus(root: string): Promise<string> { const run = promisify(execFile); const [{ stdout: head }, { stdout: statusText }] = await Promise.all([run("git", ["rev-parse", "HEAD"], { cwd: root }), run("git", ["status", "--short"], { cwd: root })]); return `HEAD ${head.trim()}\n${statusText}`.trim(); }
async function gitDiff(root: string, requested?: string, grant?: WorkspaceGrant): Promise<string> {
  const run = promisify(execFile);
  if (requested && grant) await safePath(root, requested, "read", grant);
  let paths = requested ? [requested] : ["."];
  if (grant) {
    const { stdout: names } = await run("git", ["diff", "--name-only", "--", ...paths], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
    paths = names.split("\n").filter(Boolean).filter((path) => canRead(path, grant));
    if (!paths.length) return "No tracked-file diff.";
  }
  const { stdout } = await run("git", ["diff", "--no-ext-diff", "--", ...paths], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  return stdout || "No tracked-file diff.";
}
function safeEnvironment(): NodeJS.ProcessEnv { return { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, NODE_ENV: "test", CI: "1", NO_COLOR: "1" }; }
function result(text: string, evidence: Record<string, unknown> = {}) { return { content: [{ type: "text" as const, text }], details: { digest: digest(text), size: text.length, ...evidence } }; }
async function readState(path: string): Promise<WorkspaceState | undefined> { try { const value = JSON.parse(await readFile(path, "utf8")) as Omit<WorkspaceState, "touched"> & { touched?: string[] }; return { ...value, touched: value.touched ?? [] }; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
async function saveState(path: string, state: WorkspaceState): Promise<void> { const temporary = `${path}.tmp`; await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 }); await rename(temporary, path); }
async function queue<T>(root: string, operation: () => Promise<T>): Promise<T> { const previous = mutationQueues.get(root) ?? Promise.resolve(); let release!: () => void; const next = new Promise<void>((resolveNext) => { release = resolveNext; }); const queued = previous.then(() => next); mutationQueues.set(root, queued); await previous; try { return await operation(); } finally { release(); if (mutationQueues.get(root) === queued) mutationQueues.delete(root); } }
