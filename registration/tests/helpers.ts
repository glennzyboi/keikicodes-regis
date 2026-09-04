import { expect, type Page, type BrowserContext } from "@playwright/test";
import postgres from "postgres";

/**
 * Shared fixtures for the adversarial suite.
 *
 * Everything here goes through the real UI or the real HTTP surface. Nothing
 * seeds a session directly, because a test that fakes a login proves the app
 * works for a user who cannot exist.
 */

/**
 * One client for the whole run.
 *
 * Playwright runs every spec file in the same worker process, so this module is
 * shared. Each file used to close it in afterAll, which meant the first file to
 * finish tore the pool out from under the rest and everything after it failed
 * with CONNECTION_ENDED. It is closed once, in global teardown.
 */
export const sql = postgres(process.env.DATABASE_URL!, {
  prepare: false,
  onnotice: () => {},
});

/**
 * A class with at least this many seats free, right now.
 *
 * Tests share one database and one seed, so a spec that hardcodes a class title
 * inherits whatever the specs before it did to that class. Asking for room
 * instead of a name makes each test independent of the order it runs in.
 */
export async function freeClass(minSeats = 1) {
  const [cls] = await sql<
    { id: string; title: string; capacity: number; seats_taken: number }[]
  >`select id, title, capacity, seats_taken
      from class_offerings
     where status = 'published' and capacity - seats_taken >= ${minSeats}
     order by capacity - seats_taken desc
     limit 1`;
  if (!cls) throw new Error(`no class has ${minSeats} seats free`);
  return cls;
}

export function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

export const STAFF = { email: "ops@keikicoders.test", password: "KeikiOps!2026" };

/** Create a parent account through the real signup form. */
export async function signUpParent(page: Page, email: string, name = "Test Parent") {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("TestParent!2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/portal/, { timeout: 30_000 });
}

export async function signInParent(page: Page, email: string, password = "TestParent!2026") {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/portal/, { timeout: 30_000 });
}

export async function signInStaff(page: Page) {
  await page.goto("/admin/login");
  await page.locator("#email").fill(STAFF.email);
  await page.locator("#password").fill(STAFF.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/, { timeout: 30_000 });
}

export async function signOutEverywhere(context: BrowserContext) {
  await context.clearCookies();
}

/** Fill the three part date control. */
export async function fillDate(page: Page, index: number, iso: string) {
  const [year, month, day] = iso.split("-");
  const block = page.locator(".df-parts").nth(index);
  await block.locator("select").nth(0).selectOption(month);
  await block.locator("select").nth(1).selectOption(day);
  await block.locator("select").nth(2).selectOption(year);
}

/** Pay on Stripe's hosted page with the standard test card. */
export async function payWithTestCard(page: Page) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 });
  await page.getByRole("radio", { name: "Card" }).check({ force: true });
  const cardNumber = page.getByPlaceholder("1234 1234 1234 1234");
  await expect(cardNumber).toBeVisible();
  await cardNumber.fill("4242424242424242");
  await page.getByPlaceholder("MM / YY").fill("12/30");
  await page.getByPlaceholder("CVC").fill("123");
  const name = page.getByPlaceholder("Full name on card");
  if (await name.isVisible().catch(() => false)) await name.fill("Test Parent");
  const zip = page.getByPlaceholder("ZIP");
  if (await zip.isVisible().catch(() => false)) await zip.fill("96814");
  await page.getByTestId("hosted-payment-submit-button").click();
}

/**
 * Register one child and pay, end to end. Returns the order id.
 * Used by the tests that need a real paid registration to attack.
 */
export async function registerAndPay(
  page: Page,
  classId: string,
  child: { first: string; last: string; dob: string },
) {
  await page.goto(`/register/${classId}`);
  await page.locator("#fn-0").fill(child.first);
  await page.locator("#ln-0").fill(child.last);
  await fillDate(page, 0, child.dob);
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await payWithTestCard(page);
  await page.waitForURL(/\/confirming/, { timeout: 45_000 });
  await expect(page.getByRole("heading", { name: /your keiki are/i })).toBeVisible({
    timeout: 45_000,
  });

  const orderId = new URL(page.url()).searchParams.get("order")!;
  return { orderId, classId };
}
