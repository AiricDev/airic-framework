import type { AppRoute } from "../../../app/application-handler.js";
import { HttpError } from "../../../app/application-handler.js";
import type { CaseService } from "../application/case-service.js";
import { CasePolicyError, type CaseRecord } from "../domain/case.js";

export interface AppRoutesOptions { cases: CaseService }

/**
 * The fixed registration entry for business HTTP API routes. New experience
 * slices register their routes here so the composition root never changes.
 */
export function createAppRoutes(options: AppRoutesOptions): AppRoute[] {
  const { cases } = options;
  return [
    { method: "GET", path: "/cases", handle: async () => ({ body: { cases: await cases.list() } }) },
    {
      method: "GET", path: "/cases/:id", handle: async (context) => {
        const record = await cases.get(context.params.id!);
        if (!record) throw new HttpError(404, "CaseNotFound", `Case ${context.params.id} does not exist`);
        return { body: { case: record } };
      },
    },
    {
      method: "GET", path: "/commands/:commandId", handle: async (context) => {
        const receipt = await cases.inspect(context.params.commandId!);
        if (!receipt) throw new HttpError(404, "CommandNotFound", `Command ${context.params.commandId} has no receipt`);
        return { body: { receipt: committedReceipt(receipt) } };
      },
    },
    {
      method: "POST", path: "/cases/:id/commands", handle: async (context) => {
        const input = context.body as { expectedRevision?: unknown; changes?: { customerName?: string; email?: string; markReady?: boolean } };
        if (typeof input?.expectedRevision !== "number" || !input.changes) {
          throw new HttpError(400, "InvalidCommand", "expectedRevision and changes are required");
        }
        try {
          const receipt = await cases.update({ commandId: context.commandId, caseId: context.params.id!, expectedRevision: input.expectedRevision, changes: input.changes });
          return { status: 201, body: { receipt: committedReceipt(receipt) } };
        } catch (error) {
          if (error instanceof CasePolicyError) throw policyFailure(error);
          throw error;
        }
      },
    },
  ];
}

function committedReceipt(receipt: { commandId: string; record: CaseRecord }): unknown {
  return { commandId: receipt.commandId, status: "committed", revision: String(receipt.record.revision), record: receipt.record };
}

function policyFailure(error: CasePolicyError): HttpError {
  const status = error.code === "CaseNotFound" ? 404 : error.code === "RevisionConflict" ? 409 : 422;
  return new HttpError(status, error.code, error.message, error.details);
}
