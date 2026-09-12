// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiricClient, TraceDto, WorkDto } from "@airic/client";
import { AiricWorkbench } from "../src/index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanup: Array<() => void> = [];
afterEach(() => { for (const unmount of cleanup.splice(0)) unmount(); });

function render(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(element); });
  cleanup.push(() => { act(() => root.unmount()); container.remove(); });
  return container;
}

describe("AiricWorkbench live projection", () => {
  it("refreshes the selected Work trace when an external SSE event arrives", async () => {
    const work: WorkDto = { id: "work-1", objective: "External work", input: {}, status: "open", workType: { moduleId: "cases", workTypeId: "assist" }, domainBindings: [], selectedContent: [], revision: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
    let trace: TraceDto[] = [];
    let listener: ((event: TraceDto) => void) | undefined;
    const client = {
      listWorks: vi.fn(async () => [work]),
      getWork: vi.fn(async () => ({ work, trace })),
      listWorkTypes: vi.fn(async () => []),
      getWorkspace: vi.fn(async () => ({ dirty: false, status: "", diff: "" })),
      getCapabilities: vi.fn(async () => ({ resume: false, interrupt: false, contextHook: false, compactionTrace: false })),
      subscribeTrace: vi.fn((value: (event: TraceDto) => void) => { listener = value; return () => {}; }),
    } as unknown as AiricClient;
    const container = render(<AiricWorkbench client={client} />);
    await act(async () => {});
    trace = [{ eventId: "event-1", workId: work.id, type: "message.agent", timestamp: "2026-01-01T00:00:01Z", actor: "agent", payload: { text: "Updated elsewhere" } }];
    await act(async () => { listener?.(trace[0]!); });
    expect(container.textContent).toContain("Updated elsewhere");
  });
});
