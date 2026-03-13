import { expect, test, type Page } from "@playwright/test";

const hasNoHorizontalOverflow = async (page: Page) =>
  page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth <= window.innerWidth + 1;
  });

async function register(page: Page, username: string, password: string) {
  const email = `${username}@e2e.local`;
  await page.goto("/register");
  await page.getByTestId("auth-email-input").fill(email);
  await page.getByTestId("auth-password-input").fill(password);
  await page.getByTestId("auth-confirm-input").fill(password);

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/api/auth/register/") &&
        response.request().method() === "POST",
    ),
    page.getByTestId("auth-submit-button").click(),
  ]);

  await expect(page).toHaveURL("/");
}

test("core routes have no horizontal overflow", async ({ page }) => {
  const routes = ["/", "/login", "/register", "/rooms/public"];
  for (const route of routes) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    await expect.poll(async () => hasNoHorizontalOverflow(page)).toBeTruthy();
  }
});

test("mobile shell switches between list and chat without clipping", async ({
  page,
}) => {
  const username = `m${Math.random().toString(36).slice(2, 9)}`;
  const password = "pass12345";

  await register(page, username, password);
  await page.goto("/rooms/public");

  const chatInput = page.locator("textarea").first();
  const joinCallout = page.getByTestId("group-join-callout");
  const readOnlyCallout = page.getByTestId("group-readonly-callout");
  const authCallout = page.getByTestId("chat-auth-callout");

  await expect
    .poll(
      async () =>
        (await chatInput.isVisible()) ||
        (await joinCallout.isVisible()) ||
        (await readOnlyCallout.isVisible()) ||
        (await authCallout.isVisible()),
      { timeout: 15_000 },
    )
    .toBeTruthy();
  await expect.poll(async () => hasNoHorizontalOverflow(page)).toBeTruthy();

  const isNarrowViewport = await page.evaluate(() => window.innerWidth <= 768);
  const searchInput = page.locator("aside input[aria-label]").first();
  if (isNarrowViewport) {
    await expect(searchInput).toBeHidden();
    await page.getByRole("button", { name: /Назад|Back/i }).click();
    await expect(page).toHaveURL("/");
    await expect(searchInput).toBeVisible();
  } else {
    await expect(searchInput).toBeVisible();
    await page.goto("/");
  }

  await expect.poll(async () => hasNoHorizontalOverflow(page)).toBeTruthy();
});
