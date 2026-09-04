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

export type TestClass = {
  id: string;
  title: string;
  capacity: number;
  seats_taken: number;
  grade_min: number | null;
  grade_max: number | null;
  school_slug: string;
  school: string;
};

/**
 * A class with at least this many seats free, that we actually sell.
 *
 * Tests share one database and one seed, so a spec that hardcodes a class title
 * inherits whatever the specs before it did to that class. Asking for room
 * instead of a name makes each test independent of the order it runs in.
 *
 * The registration_mode filter matters now: over half the real catalogue is
 * enrolled through the school and cannot be paid for here at all, so a test
 * that picked one at random would be testing the refusal by accident.
 */
export async function freeClass(minSeats = 1): Promise<TestClass> {
  const [cls] = await sql<TestClass[]>`
    select c.id, c.title, c.capacity, c.seats_taken, c.grade_min, c.grade_max,
           s.slug as school_slug, s.name as school
      from class_offerings c join schools s on s.id = c.school_id
     where c.status = 'published'
       and c.registration_mode = 'keiki_coders'
       and c.capacity - c.seats_taken >= ${minSeats}
     order by c.capacity - c.seats_taken desc
     limit 1`;
  if (!cls) throw new Error(`no sellable class has ${minSeats} seats free`);
  return cls;
}

/** A class the campus enrols itself, for the tests that prove we refuse it. */
export async function externalClass(): Promise<TestClass> {
  const [cls] = await sql<TestClass[]>`
    select c.id, c.title, c.capacity, c.seats_taken, c.grade_min, c.grade_max,
           s.slug as school_slug, s.name as school
      from class_offerings c join schools s on s.id = c.school_id
     where c.status = 'published' and c.registration_mode = 'external'
     limit 1`;
  if (!cls) throw new Error("no externally registered class in the catalogue");
  return cls;
}

/** A grade this class will accept, so eligibility is not what fails a test. */
export function okGrade(cls: Pick<TestClass, "grade_min" | "grade_max">): number {
  return cls.grade_min ?? cls.grade_max ?? 3;
}

/** A grade this class will refuse, or null when it accepts everybody. */
export function badGrade(cls: Pick<TestClass, "grade_min" | "grade_max">): number | null {
  if (cls.grade_max !== null && cls.grade_max < 12) return cls.grade_max + 1;
  if (cls.grade_min !== null && cls.grade_min > 0) return cls.grade_min - 1;
  return null;
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

export type ChildInput = {
  first: string;
  last: string;
  dob: string;
  /** Left out means "a grade this class accepts". */
  grade?: number;
  inCare?: boolean;
};

/**
 * Fill the registration form for one child, without submitting.
 *
 * Kept separate from registerAndPay so a spec can fill the form and then attack
 * it: submit twice, tamper with a field, skip the consent.
 */
export async function fillRegistration(page: Page, index: number, child: ChildInput, cls: TestClass) {
  await page.locator(`#fn-${index}`).fill(child.first);
  await page.locator(`#ln-${index}`).fill(child.last);
  await page.locator(`#grade-${index}`).selectOption(String(child.grade ?? okGrade(cls)));
  await fillDate(page, index, child.dob);
  // Their form requires this before payment, so ours does too.
  await page.locator(`input[type="checkbox"][required]`).nth(index).check();
}

/** Tick the policy consent, which is required for every registration. */
export async function agreeToPolicies(page: Page) {
  const boxes = page.locator('input[type="checkbox"][required]');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) {
    const box = boxes.nth(i);
    if (!(await box.isChecked())) await box.check();
  }
}

/**
 * Register one child and pay, end to end. Returns the order id.
 * Used by the tests that need a real paid registration to attack.
 */
export async function registerAndPay(
  page: Page,
  cls: TestClass,
  child: ChildInput,
) {
  await page.goto(`/register/${cls.id}`);
  await page.locator("#parent-phone").fill("808-555-0100");
  await fillRegistration(page, 0, child, cls);
  await agreeToPolicies(page);
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await payWithTestCard(page);
  await page.waitForURL(/\/confirming/, { timeout: 45_000 });
  await expect(page.getByRole("heading", { name: /your keiki are/i })).toBeVisible({
    timeout: 45_000,
  });

  const orderId = new URL(page.url()).searchParams.get("order")!;
  return { orderId, classId: cls.id };
}

/**
 * A registration payload for the API, with everything the schema now requires.
 * Specs that attack the endpoint start from this and break one field.
 */
export function apiRegistration(
  classOfferingId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    idempotencyKey: unique("api"),
    agreedToPolicies: true,
    marketingOptIn: false,
    registrations: [
      {
        classOfferingId,
        attendsSchoolConfirmed: true,
        child: {
          firstName: "Api",
          lastName: "Child",
          dateOfBirth: "2016-05-05",
          grade: 3,
          inAfterschoolCare: false,
        },
      },
    ],
    ...overrides,
  };
}
