export type WorkStatus = "open" | "completed" | "cancelled";

export interface VersionedRef {
  id: string;
  revision: string;
}

export interface DefinitionRef {
  id: string;
}

export interface DomainBindingRef {
  id: string;
  release: string;
  buildId: string;
  sourceDigest: string;
}

export interface Work {
  id: string;
  objective: string;
  input: unknown;
  status: WorkStatus;
  definition: DefinitionRef;
  domainBindings: readonly DomainBindingRef[];
  selectedContent: readonly string[];
  result?: unknown;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export function createWork(input: Omit<Work, "status" | "revision" | "createdAt" | "updatedAt" | "selectedContent"> & { now: string }): Work {
  if (!input.objective.trim()) throw new Error("Work objective is required");
  return {
    id: input.id,
    objective: input.objective,
    input: input.input,
    status: "open",
    definition: input.definition,
    domainBindings: input.domainBindings,
    selectedContent: [],
    revision: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function reviseWork(work: Work, changes: Partial<Pick<Work, "status" | "result" | "selectedContent" | "domainBindings">>, now: string): Work {
  if (work.status !== "open" && changes.status && changes.status !== work.status) {
    throw new Error(`Terminal Work ${work.id} cannot transition from ${work.status}`);
  }
  return { ...work, ...changes, revision: work.revision + 1, updatedAt: now };
}
