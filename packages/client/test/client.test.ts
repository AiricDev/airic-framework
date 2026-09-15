import { describe, expect, it, vi } from "vitest";
import { AiricClientError, createAiricClient, type EventSourceLike, type EventSourceMessage } from "../src/index.js";

class FakeEventSource implements EventSourceLike {
  readonly listeners = new Map<string, Array<(event: EventSourceMessage) => void>>();
  closed = false;
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: EventSourceMessage) => void): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  close(): void { this.closed = true; }
  emit(type: string, event: EventSourceMessage): void { for (const listener of this.listeners.get(type) ?? []) listener(event); }
}

describe("AiricClient", () => {
  it("uploads a binary Work file without embedding bytes in JSON", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ digest: "a".repeat(64), size: 3, extraction: { digest: "b".repeat(64), blocks: 1, warnings: [] } }), { status: 201 }));
    const client = createAiricClient({ fetch: request });
    const file = new File(["pdf"], "report evidence.pdf", { type: "application/pdf" });
    expect((await client.uploadEvidenceFile("work-1", file)).extraction?.blocks).toBe(1);
    expect(request).toHaveBeenCalledWith("/api/airic/works/work-1/uploads", expect.objectContaining({ method: "PUT", body: file, headers: { "content-type": "application/pdf", "x-airic-filename": "report%20evidence.pdf" } }));
  });
  it("uses the configured base path and maps typed failures", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify([{ id: "one" }]), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ error: "Missing", code: "WorkNotFound" }), { status: 404 }));
    const client = createAiricClient({ baseUrl: "/api/airic/", fetch: request });
    expect(await client.listWorks()).toEqual([{ id: "one" }]);
    await expect(client.getWork("missing")).rejects.toMatchObject<Partial<AiricClientError>>({ status: 404, code: "WorkNotFound" });
    expect(request.mock.calls[0]?.[0]).toBe("/api/airic/works");
  });

  it("sends typed request DTOs with JSON bodies", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ id: "work-1" }), { status: 201 })));
    const client = createAiricClient({ fetch: request });
    await client.createWork({ moduleId: "cases", workTypeId: "case-assistance", objective: "Help me" });
    await client.sendMessage("work-1", "hello");
    const [worksUrl, worksInit] = request.mock.calls[0]!;
    const [messagesUrl, messagesInit] = request.mock.calls[1]!;
    expect(worksUrl).toBe("/api/airic/works");
    expect(worksInit?.method).toBe("POST");
    expect(worksInit?.headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(String(worksInit?.body))).toEqual({ moduleId: "cases", workTypeId: "case-assistance", objective: "Help me", input: {} });
    expect(messagesUrl).toBe("/api/airic/works/work-1/messages");
    expect(JSON.parse(String(messagesInit?.body))).toEqual({ message: "hello" });
  });

  it("subscribes to trace events and closes without leaking the source", () => {
    let listener: ((event: EventSourceMessage) => void) | undefined; const close = vi.fn();
    const client = createAiricClient({ eventSource: () => ({ addEventListener: (type, value) => { if (type === "trace") listener = value; }, close }) });
    const seen: string[] = []; const cancel = client.subscribeTrace((event) => seen.push(event.eventId));
    listener?.({ data: JSON.stringify({ eventId: "event-1" }), lastEventId: "event-1" }); cancel();
    expect(seen).toEqual(["event-1"]); expect(close).toHaveBeenCalledOnce();
  });

  it("resumes with the last event id after a disconnect", async () => {
    const sources: FakeEventSource[] = [];
    const client = createAiricClient({ reconnectDelayMs: 0, eventSource: (url) => { const source = new FakeEventSource(url); sources.push(source); return source; } });
    const seen: string[] = [];
    const cancel = client.subscribeTrace((event) => seen.push(event.eventId));
    sources[0]!.emit("trace", { data: JSON.stringify({ eventId: "event-1" }), lastEventId: "event-1" });
    sources[0]!.emit("error", { data: "", lastEventId: "event-1" });
    expect(sources[0]!.closed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(sources).toHaveLength(2);
    expect(sources[1]!.url).toContain("lastEventId=event-1");
    sources[1]!.emit("trace", { data: JSON.stringify({ eventId: "event-2" }), lastEventId: "event-2" });
    cancel();
    expect(seen).toEqual(["event-1", "event-2"]);
    expect(sources.map((source) => source.closed)).toEqual([true, true]);
  });

  it("stops reconnecting once the subscription is cancelled", async () => {
    const sources: FakeEventSource[] = [];
    const client = createAiricClient({ reconnectDelayMs: 0, eventSource: (url) => { const source = new FakeEventSource(url); sources.push(source); return source; } });
    const cancel = client.subscribeTrace(() => {});
    sources[0]!.emit("error", { data: "", lastEventId: "" });
    cancel();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(sources).toHaveLength(1);
  });
});
