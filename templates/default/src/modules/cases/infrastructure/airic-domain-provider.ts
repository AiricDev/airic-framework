import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { CommandReceipt, DomainProvider } from "@airic/framework";
import type { CaseService } from "../application/case-service.js";
import { CasePolicyError } from "../domain/case.js";

export function createCaseDomain(service: CaseService, sourceRoot: string): DomainProvider {
  const release = "1.0.0";
  return {
    id: "case-management",
    moduleId: "cases",
    release,
    buildId: "case-management-demo-v1",
    sourceBundle: { id: "case-management-source", revision: "1", digest: createHash("sha256").update("case-domain-v1").digest("hex") },
    readme: { path: "src/domain/case.ts" },
    capabilities: [
      {
        id: "case.get", title: "Read case", description: "Read the current case and its authoritative revision.", kind: "query", source: { path: "src/application/case-service.ts", symbol: "CaseService.get" },
        inputSchema: { type: "object", properties: { caseId: { type: "string" } }, required: ["caseId"] }, outputSchema: { type: ["object", "null"] },
        invoke: async (_context, input) => service.get((input as { caseId: string }).caseId),
      },
      {
        id: "case.update", title: "Update case", description: "Update a case using optimistic revision checking; marking ready requires customer name and valid email.", kind: "command", source: { path: "src/domain/case.ts", symbol: "updateCase" },
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            caseId: { type: "string" },
            expectedRevision: { type: "number" },
            changes: {
              type: "object",
              additionalProperties: false,
              properties: {
                customerName: { type: "string" },
                email: { type: "string" },
              },
            },
          },
          required: ["caseId", "expectedRevision", "changes"],
        }, outputSchema: { type: "object" },
        invoke: async (context, input): Promise<CommandReceipt> => {
          if (!context.commandId) throw new Error("Trusted command identity is missing");
          try {
            const receipt = await service.update({ commandId: context.commandId, ...(input as { caseId: string; expectedRevision: number; changes: { customerName?: string; email?: string; markReady?: boolean } }) });
            return { commandId: context.commandId, status: "committed", revision: String(receipt.record.revision), result: receipt.record };
          } catch (error) {
            if (error instanceof CasePolicyError) return { commandId: context.commandId, status: "rejected", error: { code: error.code, message: error.message, details: error.details } };
            throw error;
          }
        },
      },
    ],
    inspectCommand: async (_context, commandId) => {
      const receipt = await service.inspect(commandId);
      return receipt ? { commandId, status: "committed", revision: String(receipt.record.revision), result: receipt.record, observedAt: new Date().toISOString() } : undefined;
    },
    readSource: async (locator) => {
      const base = resolve(sourceRoot); const path = resolve(base, locator.path);
      if (path !== base && !path.startsWith(`${base}${sep}`)) throw new Error("Source path escapes the reviewed bundle");
      return { content: await readFile(path, "utf8"), locator };
    },
  };
}
