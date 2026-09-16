export type WorkStatus = "open" | "completed" | "cancelled";

export interface VersionedRef {
  id: string;
  revision: string;
}

export interface WorkTypeRef { moduleId: string; workTypeId: string }

export interface DomainBindingRef {
  id: string;
  release: string;
  buildId: string;
  sourceDigest: string;
}
export interface WorkSourceRef { workId: string }

export interface Work {
  id: string;
  createdBy?: string;
  objective: string;
  input: unknown;
  status: WorkStatus;
  workType: WorkTypeRef;
  domainBindings: readonly DomainBindingRef[];
  sourceWorks: readonly WorkSourceRef[];
  selectedContent: readonly string[];
  result?: unknown;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export function createWork(input: Omit<Work, "status" | "revision" | "createdAt" | "updatedAt" | "selectedContent" | "sourceWorks"> & { now: string; sourceWorks?: readonly WorkSourceRef[] }): Work {
  if (!input.objective.trim()) throw new Error("Work objective is required");
  return {
    id: input.id,
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    objective: input.objective,
    input: input.input,
    status: "open",
    workType: input.workType,
    domainBindings: input.domainBindings,
    sourceWorks: input.sourceWorks ?? [],
    selectedContent: [],
    revision: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function reviseWork(work: Work, changes: Partial<Pick<Work, "status" | "result" | "selectedContent" | "domainBindings" | "sourceWorks">>, now: string): Work {
  if (work.status !== "open" && changes.status && changes.status !== work.status) {
    throw new Error(`Terminal Work ${work.id} cannot transition from ${work.status}`);
  }
  return { ...work, ...changes, revision: work.revision + 1, updatedAt: now };
}
