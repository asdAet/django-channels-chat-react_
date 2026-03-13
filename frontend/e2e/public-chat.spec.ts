import { expect, test, type Page } from "@playwright/test";

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

  await expect(page).toHaveURL("/", { timeout: 10_000 });
}

test("public chat allows authenticated send and keeps guest read-only mode", async ({
  page,
  browser,
}) => {
  const username = `c${Math.random().toString(36).slice(2, 7)}`;
  const password = "pass12345";
  const text = `hello-${Date.now()}`;

  await register(page, username, password);

  await page.goto("/rooms/public");
  const joinCallout = page.getByTestId("group-join-callout");
  if (await joinCallout.isVisible()) {
    await joinCallout
      .getByRole("button", { name: "РџСЂРёСЃРѕРµРґРёРЅРёС‚СЊСЃСЏ" })
      .click();
  }

  const input = page.getByTestId("chat-message-input");
  await expect(input).toBeVisible({ timeout: 30_000 });

  // while (true) {
  await input.fill(text);
  await page.getByTestId("chat-send-button").click();
  // }

  await expect(
    page.getByRole("article").filter({ hasText: text }).first(),
  ).toBeVisible({ timeout: 15_000 });

  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await guestPage.goto("/rooms/public");
  await expect(guestPage.getByTestId("chat-auth-callout")).toBeVisible();
  await expect(guestPage.getByTestId("chat-message-input")).toHaveCount(0);
  await guestContext.close();
});
