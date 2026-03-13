import { expect, test, type Page } from "@playwright/test";

const RETRYABLE_AUTH_STATUSES = new Set([429, 500, 502, 503, 504]);

function randomLetters(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result;
}

async function submitAuthRequestWithRetry(
  page: Page,
  endpointPath: string,
  action: string,
) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(endpointPath) &&
        response.request().method() === "POST",
    );
    await page.getByTestId("auth-submit-button").click();
    const response = await responsePromise;

    if (response.ok()) {
      return response;
    }

    if (
      !RETRYABLE_AUTH_STATUSES.has(response.status()) ||
      attempt === 3
    ) {
      const body = await response.text().catch(() => "");
      throw new Error(`${action} failed: ${response.status()} ${body}`);
    }

    await page.waitForTimeout(250 * attempt);
  }
}

async function registerAndSetUsername(page: Page, username: string, password: string) {
  const email = `${username}@e2e.local`;

  await page.goto("/register");
  await page.getByTestId("auth-email-input").fill(email);
  await page.getByTestId("auth-password-input").fill(password);
  await page.getByTestId("auth-confirm-input").fill(password);
  await submitAuthRequestWithRetry(page, "/api/auth/register/", "register");

  await expect(page).toHaveURL("/");

  await page.goto("/profile");
  await expect(page.getByTestId("profile-username-input")).toBeVisible();
  await page.getByTestId("profile-username-input").fill(username);
  const profileUpdateResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/auth/profile/") &&
      response.request().method() === "POST",
  );
  await page.getByTestId("profile-save-button").click();
  const profileUpdateResponse = await profileUpdateResponsePromise;
  if (!profileUpdateResponse.ok()) {
    const body = await profileUpdateResponse.text().catch(() => "");
    throw new Error(`profile update failed: ${profileUpdateResponse.status()} ${body}`);
  }
  await expect(page).toHaveURL(`/users/${encodeURIComponent(username)}`);
}

test("direct chat by username opens and delivers messages between users", async ({
  page,
  browser,
}) => {
  const alice = `alice${randomLetters(6)}`;
  const bob = `bob${randomLetters(6)}`;
  const password = "pass12345";
  const text = `dm-${Date.now()}`;

  await registerAndSetUsername(page, alice, password);

  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await registerAndSetUsername(bobPage, bob, password);

  await bobPage.goto(`/@${encodeURIComponent(alice)}`);
  await expect(bobPage).toHaveURL(`/@${encodeURIComponent(alice)}`);

  const input = bobPage.getByTestId("chat-message-input");
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill(text);
  await bobPage.getByTestId("chat-send-button").click();
  await expect(
    bobPage.getByRole("article").filter({ hasText: text }).first(),
  ).toBeVisible({ timeout: 15_000 });

  await page.goto(`/@${encodeURIComponent(bob)}`);
  await expect(page.getByTestId("chat-message-input")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("article").filter({ hasText: text }).first(),
  ).toBeVisible({ timeout: 15_000 });

  await bobPage.goto("/direct");
  await expect(bobPage.getByText(alice)).toBeVisible();

  await bobContext.close();
});
