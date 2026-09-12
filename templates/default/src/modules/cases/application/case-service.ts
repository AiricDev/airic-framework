import { CasePolicyError, updateCase, type CaseRecord } from "../domain/case.js";

export interface CaseRepository {
  get(id: string): Promise<CaseRecord | undefined>;
  list(): Promise<CaseRecord[]>;
  commit(commandId: string, current: CaseRecord, next: CaseRecord): Promise<{ commandId: string; record: CaseRecord }>;
  inspect(commandId: string): Promise<{ commandId: string; record: CaseRecord } | undefined>;
}

export class CaseService {
  constructor(private readonly repository: CaseRepository) {}

  async get(id: string) {
    return this.repository.get(id);
  }

  async list() {
    return this.repository.list();
  }

  async inspect(commandId: string) {
    return this.repository.inspect(commandId);
  }

  async update(command: {
    commandId: string;
    caseId: string;
    expectedRevision: number;
    changes: { customerName?: string; email?: string; markReady?: boolean };
  }) {
    const prior = await this.repository.inspect(command.commandId);
    if (prior) return prior;
    const current = await this.repository.get(command.caseId);
    if (!current) throw new CasePolicyError("CaseNotFound", `Case ${command.caseId} does not exist`);
    return this.repository.commit(command.commandId, current, updateCase(current, command.changes, command.expectedRevision));
  }
}
