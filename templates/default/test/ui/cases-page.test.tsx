// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CasesPage } from "../../src/ui/pages/cases-page.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanup: Array<() => void> = [];
afterEach(() => { for (const unmount of cleanup.splice(0)) unmount(); vi.unstubAllGlobals(); });

function render(element: ReactElement): void {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(element); });
  cleanup.push(() => { act(() => { root.unmount(); }); container.remove(); });
}

function stubFetch(body: () => Response): void {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(body())));
}

describe("cases page", () => {
  it("renders the case list with links to details", async () => {
    stubFetch(() => new Response(JSON.stringify({ cases: [{ id: "demo", customerName: "Ada Lovelace", status: "draft", revision: 1 }] }), { status: 200 }));
    render(<MemoryRouter><CasesPage /></MemoryRouter>);
    await act(async () => {});
    expect(document.querySelector(".case-list a")!.getAttribute("href")).toBe("/cases/demo");
    expect(document.querySelector(".case-list")!.textContent).toContain("Ada Lovelace");
    expect(document.querySelector(".case-list")!.textContent).toContain("draft");
  });

  it("shows the empty state when no cases exist", async () => {
    stubFetch(() => new Response(JSON.stringify({ cases: [] }), { status: 200 }));
    render(<MemoryRouter><CasesPage /></MemoryRouter>);
    await act(async () => {});
    expect(document.body.textContent).toContain("No cases yet.");
  });

  it("surfaces a mapped error when the business API fails", async () => {
    stubFetch(() => new Response(JSON.stringify({ error: "The cases are unavailable", code: "RequestFailed" }), { status: 500 }));
    render(<MemoryRouter><CasesPage /></MemoryRouter>);
    await act(async () => {});
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("The cases are unavailable");
  });
});
