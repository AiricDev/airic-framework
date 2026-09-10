import { expect, test } from "@playwright/test";

// Specs share one webServer and data directory (alphabetical order: this file runs first).
// Commit only a partial update here — workbench.spec.ts relies on the demo case still
// missing information to exercise the domain-rejection path.
test("navigates from home to cases and commits a partial update through the business API", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/cases$/);
  await expect(page.getByRole("heading", { name: "Cases" })).toBeVisible();

  await page.getByRole("link", { name: /demo/ }).click();
  await expect(page.getByRole("heading", { name: "Case" })).toBeVisible();
  await expect(page.locator(".case-summary")).toContainText("draft");

  await page.getByLabel("Customer name").fill("Grace Hopper");
  await page.getByRole("button", { name: "Commit" }).click();
  await expect(page.getByText("Committed as revision 2")).toBeVisible();
  await expect(page.locator(".case-summary")).toContainText("Grace Hopper");
  await expect(page.locator(".case-summary")).toContainText("draft");

  await expect(page.getByRole("link", { name: "Cases" })).toBeVisible();
  await page.getByRole("link", { name: "Cases", exact: true }).click();
  await expect(page.getByRole("link", { name: /Grace Hopper/ })).toBeVisible();
});

test("keeps unknown API requests out of the SPA fallback", async ({ request }) => {
  const response = await request.get("/api/unknown");
  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(await response.json()).toMatchObject({ code: "RouteNotFound" });
});
