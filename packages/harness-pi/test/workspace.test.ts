import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspaceTools } from "../src/workspace.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "airic-workspace-"));
  await mkdir(join(root, "src", "domain"), { recursive: true });
  await mkdir(join(root, "work-definitions", "operating-model-smith"), { recursive: true });
  await writeFile(join(root, "src", "domain", "case.ts"), "export const value = 1;\n");
  await writeFile(join(root, ".env"), "SECRET=hidden\n");
  const policy = {
    root,
    grants: [{
      definitionId: "domain-model-smith",
      write: ["src/domain", "test/domain"],
      denyWrite: ["src/domain/protected"],
      checks: [{ id: "safe_env", title: "safe environment", command: process.execPath, args: ["-e", "process.stdout.write(String(process.env.AIRIC_API_KEY))"] }],
    }],
  } as const;
  const tools = await createWorkspaceTools({ policy, definitionId: "domain-model-smith", stateDirectory: join(root, ".airic-state") });
  const call = async (name: string, value: unknown = {}) => {
    const tool = tools.find((candidate) => candidate.name === name); if (!tool) throw new Error(`Missing ${name}`);
    return tool.execute("call", value, undefined as never, undefined as never, undefined as never) as Promise<{ content: { text: string }[] }>;
  };
  return { root, tools, call };
}

describe("Pi workspace tools", () => {
  it("grants tools only to configured Work Definitions", async () => {
    const { root } = await fixture();
    expect(await createWorkspaceTools({ policy: { root, grants: [] }, definitionId: "case-assistance", stateDirectory: join(root, "none") })).toEqual([]);
  });

  it("confines reads and writes, rejects secrets and detects concurrent changes", async () => {
    const { root, call } = await fixture();
    await expect(call("workspace_read", { path: ".env" })).rejects.toThrow("private");
    await expect(call("workspace_read", { path: "../outside" })).rejects.toThrow("escapes");
    await expect(call("workspace_write", { path: "src/application/service.ts", content: "x" })).rejects.toThrow("not granted");
    await call("workspace_edit", { path: "src/domain/case.ts", oldText: "value = 1", newText: "value = 2" });
    expect(await readFile(join(root, "src/domain/case.ts"), "utf8")).toContain("value = 2");
    await writeFile(join(root, "src", "domain", "case.ts"), "external\n");
    await expect(call("workspace_write", { path: "src/domain/case.ts", content: "overwrite\n" })).rejects.toThrow("WorkspaceConflict");
  });

  it("rejects symlink traversal and scrubs host secrets from checks", async () => {
    const { root, call } = await fixture();
    await symlink(tmpdir(), join(root, "src", "domain", "linked"));
    await expect(call("workspace_read", { path: "src/domain/linked/anything" })).rejects.toThrow("Symbolic links");
    process.env.AIRIC_API_KEY = "must-not-leak";
    const checked = await call("workspace_check_safe_env");
    delete process.env.AIRIC_API_KEY;
    expect(checked.content[0]?.text).toBe("undefined");
  });

  it("reports a persisted Work-relative change set", async () => {
    const { call } = await fixture();
    await call("workspace_write", { path: "test/domain/case.test.ts", content: "test\n" });
    const changed = await call("workspace_changes");
    expect(changed.content[0]?.text).toContain('"status": "added"');
    expect(changed.content[0]?.text).toContain("test/domain/case.test.ts");
  });
});
