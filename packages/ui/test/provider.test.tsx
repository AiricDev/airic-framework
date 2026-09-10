// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAiricClient, type AiricClient, type EventSourceLike } from "@airic/client";
import { AiricProvider, useAiricClient, useWorks } from "../src/index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanup: Array<() => void> = [];
afterEach(() => { for (const unmount of cleanup.splice(0)) unmount(); });

function render(element: ReactElement): void {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(element); });
  cleanup.push(() => { act(() => { root.unmount(); }); container.remove(); });
}

class FakeEventSource implements EventSourceLike {
  closed = false;
  addEventListener(): void {}
  close(): void { this.closed = true; }
}

describe("AiricProvider hooks", () => {
  it("shares one client across multiple components", () => {
    const client = createAiricClient({ fetch: vi.fn() });
    const seen: AiricClient[] = [];
    const Probe = () => { seen.push(useAiricClient()); return null; };
    render(<AiricProvider client={client}><Probe /><Probe /></AiricProvider>);
    expect(seen).toEqual([client, client]);
  });

  it("loads works, rebuilds through refresh and maps request failures", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "one" }]), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify([{ id: "one" }, { id: "two" }]), { status: 200 }));
    const source = new FakeEventSource();
    const client = createAiricClient({ fetch: request, eventSource: () => source });
    const states: unknown[] = [];
    const WorksProbe = () => { const works = useWorks(); states.push({ data: works.data, error: works.error?.message, loading: works.loading }); return <button onClick={() => void works.refresh()}>refresh</button>; };
    render(<AiricProvider client={client}><WorksProbe /></AiricProvider>);
    await act(async () => {});
    expect(states.at(-1)).toMatchObject({ data: [{ id: "one" }], loading: false });

    await act(async () => { document.querySelector("button")!.click(); });
    expect(states.at(-1)).toMatchObject({ data: [{ id: "one" }, { id: "two" }] });

    expect(source.closed).toBe(false);
    for (const unmount of cleanup.splice(0)) unmount();
    expect(source.closed).toBe(true);
  });

  it("surfaces mapped errors when the request fails", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "unavailable", code: "RequestFailed" }), { status: 503 }));
    const client = createAiricClient({ fetch: request, eventSource: () => new FakeEventSource() });
    const states: unknown[] = [];
    const WorksProbe = () => { const works = useWorks(); states.push({ error: works.error?.message, loading: works.loading }); return null; };
    render(<AiricProvider client={client}><WorksProbe /></AiricProvider>);
    await act(async () => {});
    expect(states.at(-1)).toMatchObject({ error: "unavailable", loading: false });
  });
});
