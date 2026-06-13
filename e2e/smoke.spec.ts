import { expect, test } from "@playwright/test";

test.describe("DevTrack smoke E2E", () => {
  test("landing page loads with hero and CTA", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/DevTrack/i);
    await expect(
      page.getByRole("heading", { name: /issue tracker built for speed/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /get started|sign up|start/i }).first()).toBeVisible();
  });

  test("pricing page loads plan content", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page).toHaveTitle(/pricing/i);
    await expect(page.getByText(/free|pro|enterprise/i).first()).toBeVisible();
  });

  test("sign-in page renders Clerk auth UI", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.locator(".cl-rootBox, [data-clerk-component], .cl-signIn-root")).toBeVisible({
      timeout: 60_000,
    });
  });

  test("sign-up page renders Clerk auth UI", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.locator(".cl-rootBox, [data-clerk-component], .cl-signUp-root")).toBeVisible({
      timeout: 60_000,
    });
  });

  test("protected onboarding route requires auth", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/sign-in/);
  });

  test("protected workspace route requires auth", async ({ page }) => {
    await page.goto("/acme");
    await expect(page).toHaveURL(/sign-in/);
  });

  test("marketing nav links work", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /pricing/i }).first().click();
    await expect(page).toHaveURL(/\/pricing/);
  });
});

test.describe("Convex backend reachability", () => {
  test("webhook endpoint is deployed", async ({ request }) => {
    const siteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
    test.skip(!siteUrl, "NEXT_PUBLIC_CONVEX_SITE_URL not set");

    const response = await request.post(`${siteUrl}/clerk-webhook`, {
      data: { type: "test" },
    });
    const body = await response.text();

    // 400 = handler running, missing Svix headers. 500 = handler running, secret not set yet.
    expect([400, 500]).toContain(response.status());
    expect(body).toMatch(/Missing svix headers|Webhook secret not configured/i);
  });
});
