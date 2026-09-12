import { describe, expect, it } from "vitest";
import { CasePolicyError, updateCase } from "../domain/case.js";

describe("case domain", () => {
  it("requires both customer name and valid email before readiness", () => {
    expect(() => updateCase({ id: "one", status: "draft", revision: 1 }, { customerName: "Ada", markReady: true }, 1)).toThrowError(CasePolicyError);
    expect(updateCase({ id: "one", status: "draft", revision: 1 }, { customerName: "Ada", email: "ADA@example.com", markReady: true }, 1)).toMatchObject({ status: "ready", email: "ada@example.com", revision: 2 });
  });
  it("rejects a stale revision", () => {
    expect(() => updateCase({ id: "one", status: "draft", revision: 3 }, {}, 2)).toThrow("Expected revision 2");
  });
  it("rejects an empty or unsupported change instead of committing a new revision", () => {
    expect(() => updateCase({ id: "one", status: "draft", revision: 1 }, {}, 1)).toThrow("At least one supported case change is required");
    expect(() => updateCase({ id: "one", status: "draft", revision: 1 }, { status: "ready" } as never, 1)).toThrow("At least one supported case change is required");
  });
});
