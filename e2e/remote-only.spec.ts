import { expect, test } from "@playwright/test";

// Regression: remote-only marks on an in-person event saved fine but were
// invisible in results (feasible=0 rendered like an empty cell). They must
// show as violet ⌂ cells plus an "everyone's remote-only" hint.
test("remote-only marks populate the results heatmap", async ({ page, request }) => {
  const day = "2026-10-07";
  const create = await request.post("/api/events", {
    data: {
      name: "Remote marks",
      format: "IN_PERSON",
      location: "EITHER",
      days: [day],
      startMin: 1020, // 5:00 PM
      endMin: 1200, // 8:00 PM
      slotMinutes: 30,
      travelMin: 30,
    },
  });
  const { slug } = await create.json();

  // Aylin marks 5:00–8:00 remote in round 2 via API.
  const join = await request.post(`/api/events/${slug}/participants`, {
    data: { name: "aylin" },
  });
  const { participantId } = await join.json();
  await request.put(`/api/events/${slug}/participants/${participantId}/selections`, {
    data: {
      round: 2,
      selections: {
        [`${day}@1020`]: "REMOTE",
        [`${day}@1050`]: "REMOTE",
        [`${day}@1080`]: "REMOTE",
        [`${day}@1110`]: "REMOTE",
        [`${day}@1140`]: "REMOTE",
        [`${day}@1170`]: "REMOTE",
      },
    },
  });

  // philippe joins through the UI and paints the same remote block.
  await page.goto(`/e/${slug}`);
  await page.getByPlaceholder("Your name").fill("philippe");
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.getByText("Where you'll be:")).toBeVisible();

  await page.getByRole("button", { name: "② All available" }).click();
  await page.getByRole("button", { name: "Remote" }).click();
  const cells = page.locator('[data-testid="grid-editor"] div.h-6.w-28');
  await cells.nth(2).click();
  await cells.nth(3).click();
  await cells.nth(4).click();
  await cells.nth(5).click();

  // Union view: all six remote-marked slots are violet, but the overlap
  // note only covers 6:00–8:00 where BOTH participants are remote-only.
  const results = page.getByTestId("results-panel");
  await results.getByRole("button", { name: "All availability" }).click();
  await expect(results.locator("div.bg-violet-200")).toHaveCount(6);
  await expect(
    results.getByText("Everyone's remote-only Wed, Oct 7 6:00 PM–8:00 PM — switch to hybrid to make it work."),
  ).toBeVisible();
});
