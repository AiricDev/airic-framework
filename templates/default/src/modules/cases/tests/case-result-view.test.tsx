// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { caseResultView } from "../experience/result-views/case-result-view.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanup: Array<() => void> = [];
afterEach(() => { for (const unmount of cleanup.splice(0)) unmount(); vi.unstubAllGlobals(); });

function render(element: ReactElement): void {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(<MemoryRouter>{element}</MemoryRouter>); });
  cleanup.push(() => { act(() => { root.unmount(); }); container.remove(); });
}

function stubFetch(body: () => Response): void {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(body())));
}

describe("case result view", () => {
  it("reads the authoritative case through the business API", async () => {
    stubFetch(() => new Response(JSON.stringify({ case: { id: "demo", customerName: "Ada Lovelace", email: "ada@example.com", status: "ready", revision: 2 } }), { status: 200 }));
    render(<>{caseResultView.render({ type: "case", id: "demo" })}</>);
    await act(async () => {});
    expect(document.querySelector(".case-summary")!.textContent).toContain("Ada Lovelace");
    expect(document.querySelector(".case-summary")!.textContent).toContain("ready");
    const link = document.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/cases/demo");
    expect(link?.textContent).toContain("Open case");
  });

  it("explains when the work result carries no case reference", async () => {
    render(<>{caseResultView.render({ type: "case" })}</>);
    await act(async () => {});
    expect(document.body.textContent).toContain("no case reference");
  });

  it("shows the business API failure instead of a fabricated case", async () => {
    stubFetch(() => new Response(JSON.stringify({ error: "Case missing does not exist", code: "CaseNotFound" }), { status: 404 }));
    render(<>{caseResultView.render({ type: "case", id: "missing" })}</>);
    await act(async () => {});
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("Case missing does not exist");
  });
});
