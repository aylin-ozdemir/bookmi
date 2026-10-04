import { expect, test } from "@playwright/test";

// The demo story end-to-end: an in-person Central meeting where the naive
// When2Meet overlap (12:45) is impossible for a participant committed to
// North until 12:30 — BookMi must recommend 1:00 PM instead, and the
// heatmap must update instantly from client-side computation.
test("travel buffer picks the commutable slot", async ({ page, request }) => {
  const day = "2026-10-06";
  const create = await request.post("/api/events", {
    data: {
      name: "Commute test",
      format: "IN_PERSON",
      location: "CENTRAL",
      days: [day],
      startMin: 720, // 12:00
      endMin: 960, // 16:00
      slotMinutes: 15,
      travelMin: 30,
    },
  });
  const { slug } = await create.json();

  // Ravi joins via API and marks preferred Central slots 12:15–1:00.
  const join = await request.post(`/api/events/${slug}/participants`, {
    data: { name: "Ravi" },
  });
  const { participantId } = await join.json();
  await request.put(`/api/events/${slug}/participants/${participantId}/selections`, {
    data: {
      round: 1,
      selections: {
        [`${day}@735`]: "CENTRAL",
        [`${day}@765`]: "CENTRAL",
        [`${day}@780`]: "CENTRAL",
      },
    },
  });

  // Aylin joins through the UI.
  await page.goto(`/e/${slug}`);
  await page.getByPlaceholder("Your name").fill("Aylin");
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.getByText("Where you'll be:")).toBeVisible();

  const cells = page.locator('[data-testid="grid-editor"] div.h-6.w-28');
  // committed to North 12:00–12:30 (rows 0 and 1)
  await page.getByRole("button", { name: "North" }).click();
  await cells.nth(0).click();
  await cells.nth(1).click();
  // flexible at 12:45 and 1:00 (rows 3 and 4)
  await page.getByRole("button", { name: "Flexible" }).click();
  await cells.nth(3).click();
  await cells.nth(4).click();

  // 12:45 is only 15 min after her North commitment — unreachable.
  // 1:00 PM works for everyone → recommended, shown instantly, and the
  // panel defaults to "First choices" since a preferred slot works.
  await expect(page.getByText("Everyone's first choice works")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "First choices" }),
  ).toHaveClass(/bg-zinc-900/);
  await expect(
    page.getByRole("listitem").filter({ hasText: "1:00 PM" }),
  ).toBeVisible();
});
