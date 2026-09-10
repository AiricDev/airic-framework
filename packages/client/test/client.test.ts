import { describe, expect, it, vi } from "vitest";
import { AiricClientError, createAiricClient, type EventSourceMessage } from "../src/index.js";

describe("AiricClient", () => {
  it("uses the configured base path and maps typed failures", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify([{ id: "one" }]), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ error: "Missing", code: "WorkNotFound" }), { status: 404 }));
    const client = createAiricClient({ baseUrl: "/api/airic/", fetch: request });
    expect(await client.listWorks()).toEqual([{ id: "one" }]);
    await expect(client.getWork("missing")).rejects.toMatchObject<Partial<AiricClientError>>({ status: 404, code: "WorkNotFound" });
    expect(request.mock.calls[0]?.[0]).toBe("/api/airic/works");
  });

  it("subscribes to trace events and closes without leaking the source", () => {
    let listener: ((event: EventSourceMessage) => void) | undefined; const close = vi.fn();
    const client = createAiricClient({ eventSource: () => ({ addEventListener: (_type, value) => { listener = value; }, close }) });
    const seen: string[] = []; const cancel = client.subscribeTrace((event) => seen.push(event.eventId));
    listener?.({ data: JSON.stringify({ eventId: "event-1" }), lastEventId: "event-1" }); cancel();
    expect(seen).toEqual(["event-1"]); expect(close).toHaveBeenCalledOnce();
  });
});
