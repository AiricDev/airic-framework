import { createContext, useContext, useEffect, useState, type PropsWithChildren } from "react";
import type { AiricClient, WorkTypeSummaryDto, WorkDetailDto, WorkDto, WorkspaceStatusDto } from "@airic/client";

const AiricClientContext = createContext<AiricClient | undefined>(undefined);
export function AiricProvider({ client, children }: PropsWithChildren<{ client: AiricClient }>) { return <AiricClientContext.Provider value={client}>{children}</AiricClientContext.Provider>; }
export function useAiricClient(): AiricClient { const client = useContext(AiricClientContext); if (!client) throw new Error("useAiricClient must be used inside AiricProvider"); return client; }
export function useOptionalAiricClient(): AiricClient | undefined { return useContext(AiricClientContext); }

export function useWorks() {
  const client = useAiricClient(); const [data, setData] = useState<WorkDto[]>([]); const [error, setError] = useState<Error>(); const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; const load = () => client.listWorks().then((value) => { if (active) setData(value); }).catch((cause) => { if (active) setError(asError(cause)); }).finally(() => { if (active) setLoading(false); }); void load(); const cancel = client.subscribeTrace(() => { void load(); }); return () => { active = false; cancel(); }; }, [client]);
  return { data, error, loading, refresh: () => client.listWorks().then(setData) };
}
export function useWork(id: string | undefined) {
  const client = useAiricClient(); const [data, setData] = useState<WorkDetailDto>(); const [error, setError] = useState<Error>(); const [loading, setLoading] = useState(Boolean(id));
  useEffect(() => { if (!id) { setData(undefined); setLoading(false); return; } let active = true; const load = () => client.getWork(id).then((value) => { if (active) setData(value); }).catch((cause) => { if (active) setError(asError(cause)); }).finally(() => { if (active) setLoading(false); }); void load(); const cancel = client.subscribeTrace((event) => { if (event.workId === id) void load(); }); return () => { active = false; cancel(); }; }, [client, id]);
  return { data, error, loading, refresh: () => id ? client.getWork(id).then(setData) : Promise.resolve() };
}
export function useWorkTypes() { return useResource<WorkTypeSummaryDto[]>((client) => client.listWorkTypes(), []); }
export function useWorkspace() { return useResource<WorkspaceStatusDto | undefined>(async (client) => { try { return await client.getWorkspace(); } catch { return undefined; } }, undefined); }
function useResource<T>(load: (client: AiricClient) => Promise<T>, initial: T) {
  const client = useAiricClient(); const [data, setData] = useState<T>(initial); const [error, setError] = useState<Error>(); const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; const refresh = () => load(client).then((value) => { if (active) setData(value); }).catch((cause) => { if (active) setError(asError(cause)); }).finally(() => { if (active) setLoading(false); }); void refresh(); const cancel = client.subscribeTrace(() => { void refresh(); }); return () => { active = false; cancel(); }; }, [client]);
  return { data, error, loading, refresh: () => load(client).then(setData) };
}
function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
