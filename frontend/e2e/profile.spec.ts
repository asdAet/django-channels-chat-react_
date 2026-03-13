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

test("profile update works with validation and save", async ({ page }) => {
  const username = `p${randomLetters(8)}`;
  const password = "pass12345";
  const nextBio = "Updated profile bio text";

  await registerAndSetUsername(page, username, password);

  await page.goto("/profile");
  const bioField = page.getByTestId("profile-bio-input");
  await expect(bioField).toBeVisible();
  await bioField.fill(nextBio);
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
  await expect(
    page.getByTestId("profile-bio-section").getByText(nextBio),
  ).toBeVisible();
});
