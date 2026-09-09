import { expect, test } from "@playwright/test";

test("creates and completes a governed transaction in simulated mode", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Start a governed work" })).toBeVisible();
  await page.getByRole("button", { name: "New work" }).click();
  await expect(page.getByRole("heading", { name: "Help me complete this transaction" })).toBeVisible();
  await page.getByLabel("Message").fill("submit");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/domain did not accept completion yet/i)).toBeVisible();
  await page.getByLabel("Message").fill("name is Ada Lovelace, ada@example.com");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("The domain accepted the transaction and the case is ready.")).toBeVisible();
  await expect(page.locator(".status", { hasText: "completed" })).toBeVisible();
  await page.getByRole("button", { name: "Reflect" }).click();
  await page.getByLabel("Message").fill("Review the failure and propose a focused improvement");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/produced an operating-model candidate/i)).toBeVisible();
  await page.getByText("Reflection (1)").click();
  await expect(page.getByText(/case-assistance\/process\.md/)).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: /Reflect on/i })).toBeVisible();
  await page.getByText("Reflection (1)").click();
  await expect(page.getByText(/case-assistance\/process\.md/)).toBeVisible();
});
