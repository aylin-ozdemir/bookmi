import { expect, test } from "@playwright/test";

// Full UI happy path: create an event, join, paint preferred + available
// grids, and see the group results panel. Verifies the client-side wiring
// that API tests can't reach (localStorage join, drag painting, autosave,
// heatmap rendering).
test("create → join → paint → results", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("Team standup").fill("E2E study group");
  await page.getByRole("button", { name: "Virtual" }).click();
  await page.getByRole("button", { name: "Create event" }).click();

  // lands on the event room
  await expect(page).toHaveURL(/\/e\//);
  await expect(page.getByText("Join this event")).toBeVisible();

  await page.getByPlaceholder("Your name").fill("E2E Tester");
  await page.getByRole("button", { name: "Join", exact: true }).click();

  // grid editor appears with the location brush
  await expect(page.getByText("Where you'll be:")).toBeVisible();
  await expect(page.getByText("① Preferred")).toBeVisible();

  // paint three cells in the preferred grid (Remote brush so loc ≠ committed)
  await page.getByRole("button", { name: "Remote" }).click();
  const cells = page.locator('[data-testid="grid-editor"] div.h-6.w-28');
  await cells.nth(0).click();
  await cells.nth(1).click();
  await cells.nth(2).click();

  // autosave kicks in
  await expect(page.getByText("Saved")).toBeVisible({ timeout: 5000 });

  // results panel renders and shows the single participant's overlap
  await expect(page.getByText("Group results")).toBeVisible();
  await expect(page.getByText("Everyone's first choice works")).toBeVisible();

  // switch to round 2 — pre-painted with the round-1 cells
  await page.getByText("② All available").click();
  const painted = page.locator("div.h-6.w-28.bg-violet-400");
  await expect(painted).toHaveCount(3);
});
