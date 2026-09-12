import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CaseService } from "../application/case-service.js";
import { JsonCaseRepository } from "../infrastructure/json-case-repository.js";

const roots: string[] = [];
async function fixture(): Promise<CaseService> {
  const root = mkdtempSync(join(tmpdir(), "case-service-"));
  roots.push(root);
  const repository = new JsonCaseRepository(join(root, "cases.json"));
  await repository.initialize();
  return new CaseService(repository);
}
afterAll(() => { for (const root of roots) void import("node:fs/promises").then((fs) => fs.rm(root, { recursive: true, force: true })); });

describe("case application service", () => {
  it("lists seeded cases and completes the ready flow with receipts", async () => {
    const cases = await fixture();
    expect((await cases.list()).map((record) => record.id)).toEqual(["demo"]);
    const receipt = await cases.update({ commandId: "command-1", caseId: "demo", expectedRevision: 1, changes: { customerName: "Ada Lovelace", email: "ada@example.com", markReady: true } });
    expect(receipt).toMatchObject({ commandId: "command-1", record: { status: "ready", revision: 2 } });
    expect(await cases.inspect("command-1")).toMatchObject({ commandId: "command-1" });
  });

  it("is idempotent for a repeated command identity", async () => {
    const cases = await fixture();
    const first = await cases.update({ commandId: "command-repeat", caseId: "demo", expectedRevision: 1, changes: { customerName: "Ada Lovelace" } });
    const second = await cases.update({ commandId: "command-repeat", caseId: "demo", expectedRevision: 1, changes: { customerName: "Ada Lovelace" } });
    expect(second.record).toEqual(first.record);
  });

  it("rejects stale revisions and unknown cases", async () => {
    const cases = await fixture();
    await expect(cases.update({ commandId: "command-2", caseId: "demo", expectedRevision: 7, changes: { customerName: "Ada" } })).rejects.toThrow("Expected revision 7");
    await expect(cases.update({ commandId: "command-3", caseId: "missing", expectedRevision: 1, changes: { customerName: "Ada" } })).rejects.toThrow("does not exist");
  });
});
