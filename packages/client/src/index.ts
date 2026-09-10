export interface WorkDto {
  id: string;
  objective: string;
  input: unknown;
  status: "open" | "completed" | "cancelled";
  definition: { id: string };
  domainBindings: readonly unknown[];
  selectedContent: readonly string[];
  result?: unknown;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface TraceDto { eventId: string; workId: string; type: string; timestamp: string; actor: string; payload: unknown }
export interface WorkDetailDto { work: WorkDto; trace: TraceDto[] }
export interface DefinitionSummaryDto { id: string; title: string; digest: string }
export interface DefinitionFilesDto { digest: string; files: Record<string, string> }
export interface WorkspaceStatusDto { gitHead?: string; dirty: boolean; status: string; diff: string }
export interface HarnessCapabilitiesDto { resume: boolean; interrupt: boolean; contextHook: boolean; compactionTrace: boolean; workspaceDefinitions?: string[] }
export interface AiricErrorBody { error: string; code?: string; details?: unknown }
export class AiricClientError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: unknown) { super(message); this.name = "AiricClientError"; }
}

export interface EventSourceMessage { data: string; lastEventId: string }
export interface EventSourceLike { addEventListener(type: string, listener: (event: EventSourceMessage) => void): void; close(): void }
export interface AiricClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  eventSource?: (url: string) => EventSourceLike;
}
export interface CreateWorkInput { definitionId: string; objective: string; input?: unknown; domainIds?: readonly string[] }

export class AiricClient {
  readonly baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #eventSource: (url: string) => EventSourceLike;
  constructor(options: AiricClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "/api/airic").replace(/\/$/u, "");
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#eventSource = options.eventSource ?? ((url) => new EventSource(url) as unknown as EventSourceLike);
  }
  health(): Promise<{ ok: boolean }> { return this.#get("/health"); }
  listWorks(): Promise<WorkDto[]> { return this.#get("/works"); }
  createWork(input: CreateWorkInput): Promise<WorkDto> { return this.#post("/works", { input: {}, domainIds: [], ...input }); }
  getWork(id: string): Promise<WorkDetailDto> { return this.#get(`/works/${encodeURIComponent(id)}`); }
  getTrace(id: string): Promise<TraceDto[]> { return this.#get(`/works/${encodeURIComponent(id)}/trace`); }
  sendMessage(id: string, message: string): Promise<{ text: string; result?: unknown }> { return this.#post(`/works/${encodeURIComponent(id)}/messages`, { message }); }
  interrupt(id: string): Promise<{ interrupted: boolean }> { return this.#post(`/works/${encodeURIComponent(id)}/interrupt`, {}); }
  complete(id: string, result: unknown): Promise<WorkDto> { return this.#post(`/works/${encodeURIComponent(id)}/complete`, { result }); }
  createReflection(input: CreateWorkInput): Promise<WorkDto> { return this.createWork(input); }
  listDefinitions(): Promise<DefinitionSummaryDto[]> { return this.#get("/definitions"); }
  getDefinition(id: string): Promise<DefinitionFilesDto> { return this.#get(`/definitions/${encodeURIComponent(id)}`); }
  getCapabilities(): Promise<HarnessCapabilitiesDto> { return this.#get("/capabilities"); }
  getWorkspace(): Promise<WorkspaceStatusDto> { return this.#get("/workspace"); }
  uploadEvidence(workId: string, input: { name: string; mediaType: string; contentBase64: string }): Promise<{ ref: unknown }> { return this.#post(`/works/${encodeURIComponent(workId)}/uploads`, input); }
  subscribeTrace(listener: (event: TraceDto) => void): () => void {
    const source = this.#eventSource(`${this.baseUrl}/events`);
    source.addEventListener("trace", (event) => listener(JSON.parse(event.data) as TraceDto));
    return () => source.close();
  }
  async #get<T>(path: string): Promise<T> { return this.#checked<T>(await this.#fetch(`${this.baseUrl}${path}`)); }
  async #post<T>(path: string, body: unknown): Promise<T> { return this.#checked<T>(await this.#fetch(`${this.baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })); }
  async #checked<T>(response: Response): Promise<T> {
    const value = await response.json() as T | AiricErrorBody;
    if (!response.ok) { const failure = value as AiricErrorBody; throw new AiricClientError(failure.error || response.statusText, response.status, failure.code, failure.details); }
    return value as T;
  }
}

export function createAiricClient(options: AiricClientOptions = {}): AiricClient { return new AiricClient(options); }
