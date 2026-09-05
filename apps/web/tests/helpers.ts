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

export const STAFF = { email: "ops@keikicoders.com", password: "KeikiOps!2026" };

/** Create a parent account through the real signup form. */
export async function signUpParent(page: Page, email: string, name = "Test Parent") {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("TestParent!2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

export async function signInParent(page: Page, email: string, password = "TestParent!2026") {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
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

/**
 * Fill the date control.
 *
 * Three typed boxes now, not three selects. The `.df-parts` hook is kept
 * deliberately so this is the only place that had to change, and the boxes are
 * addressed by class rather than by position so reordering them would fail
 * loudly rather than silently entering a month as a day.
 */
export async function fillDate(page: Page, index: number, iso: string) {
  const [year, month, day] = iso.split("-");
  const block = page.locator(".df-parts").nth(index);
  await block.locator(".df-d").fill(day);
  await block.locator(".df-m").fill(month);
  await block.locator(".df-y").fill(year);
}

/**
 * Pay with the standard test card, in the embedded checkout.
 *
 * Checkout is no longer a redirect to checkout.stripe.com, so there is no URL to
 * wait for: the card fields arrive in an iframe inside our own page and the
 * whole interaction happens through a frameLocator. Everything sensitive is
 * still on Stripe's origin, which is the point of the iframe and the reason this
 * app is still nowhere near a card number.
 *
 * Stripe nests its frames, and which frame holds the card fields is Stripe's
 * business rather than ours, so this looks through every frame on the page for
 * the card number field instead of hard coding a path that Stripe is free to
 * change under us.
 */
export async function payWithTestCard(page: Page) {
  // A viewport tall enough to hold the whole thing.
  //
  // Stripe's embedded iframe is around 1,400px of order summary, wallet buttons
  // and an accordion. In an 720px window both the Card row and the pay button
  // are below the fold, and a click on either fails with "element is outside of
  // the viewport" even with `force`, because a real click still needs
  // coordinates. Making the window taller fixes every one of those at once and
  // keeps the interactions honest clicks rather than dispatched events.
  await page.setViewportSize({ width: 1280, height: 2400 });

  // The provider mounts, then Stripe injects. Waiting on our own container
  // first gives a clear failure ("checkout never mounted") rather than a frame
  // hunt that times out for an unrelated reason.
  await expect(page.locator(".kc-checkout")).toBeVisible({ timeout: 45_000 });


  /**
   * Find whichever frame currently holds a selector, wherever Stripe put it.
   *
   * Stripe nests iframes several deep, the path is versioned into the URL, and
   * the layout is not even stable between renders: sometimes the card fields are
   * behind an accordion that has to be opened, sometimes they are already there.
   * A hard coded chain of frameLocators is a thing that breaks on a Tuesday for
   * a reason nobody here controls. Searching costs milliseconds and survives
   * Stripe rearranging its own furniture, which it is entitled to do.
   */
  const findIn = async (selector: string, ms = 45_000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      for (const f of page.frames()) {
        const n = await f.locator(selector).count().catch(() => 0);
        if (n > 0) return f;
      }
      await page.waitForTimeout(250);
    }
    return null;
  };

  const CARD = 'input[placeholder="1234 1234 1234 1234"]';

  // The payment methods are usually an accordion with nothing selected, so the
  // card fields do not exist in any frame until Card is chosen. "Usually",
  // hence the check: when card is the only method Stripe renders the form
  // directly and there is no accordion to open.
  if (!(await findIn(CARD, 4_000))) {
    const accordion = await findIn('[data-testid="card-accordion-item-button"]', 20_000);
    if (accordion) {
      // It has to be the button rather than the radio beside it: the radio is
      // `tabindex="-1"` and Stripe drives its state from the button, so checking
      // the radio reports "clicking the checkbox did not change its state" and
      // nothing opens.
      //
      // `evaluate(el => el.click())` rather than Playwright's click. Stripe's
      // iframe is taller than any viewport worth setting, and a Playwright
      // click, even a forced one, still needs coordinates inside the frame's
      // viewport: it fails with "element is outside of the viewport" and
      // scrolling the frame does not reliably help. The element's own click()
      // reaches the same React handler with no geometry involved.
      await accordion
        .locator('[data-testid="card-accordion-item-button"]')
        .evaluate((el: HTMLElement) => el.click());
    }
  }

  const cardFrame = await findIn(CARD);
  if (!cardFrame) throw new Error("the embedded checkout never showed a card number field");

  await cardFrame.locator(CARD).fill("4242424242424242");
  await cardFrame.locator('input[placeholder="MM / YY"]').fill("12/30");
  await cardFrame.locator('input[placeholder="CVC"]').fill("123");

  for (const [placeholder, value] of [
    ["Full name on card", "Test Parent"],
    ["ZIP", "96814"],
  ] as const) {
    const f = await findIn(`input[placeholder="${placeholder}"]`, 2_000);
    if (f) await f.locator(`input[placeholder="${placeholder}"]`).fill(value);
  }

  // Same geometry problem as the accordion, same answer.
  const submitFrame = await findIn('[data-testid="hosted-payment-submit-button"]', 20_000);
  if (!submitFrame) throw new Error("the embedded checkout never showed a pay button");
  await submitFrame
    .locator('[data-testid="hosted-payment-submit-button"]')
    .evaluate((el: HTMLElement) => el.click());
}

/**
 * Attach a photo to one child's file input.
 *
 * A head shot is required now, as it is on their own Fillout form, so every
 * registration in this suite has to supply one. Built in the page rather than
 * read from a fixture so there is no binary in the repo and no path to get
 * wrong on another machine.
 */
export async function attachPhoto(page: Page, index = 0) {
  await page.evaluate(async (i) => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 1200;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#399681";
    ctx.fillRect(0, 0, 900, 1200);
    const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.9));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "child.jpg", { type: "image/jpeg" }));
    const input = document.querySelectorAll<HTMLInputElement>('input[type="file"]')[i];
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, index);

  // The upload is a real round trip to storage, so wait for it to land rather
  // than racing the submit.
  await expect(
    page.locator(".kc-photo-hint").nth(index).getByText("Saved."),
  ).toBeVisible({ timeout: 20_000 });
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
  // Their form requires this before payment, so ours does too. Found by id
  // rather than by [required]: the form validates in its own code now, so the
  // attribute is gone and a selector built on it would silently match nothing.
  await page.locator(`#attends-${index}`).check();
  await attachPhoto(page, index);
}

/**
 * Tick everything the form insists on: the campus attestation for each child,
 * and the one policy consent.
 */
export async function agreeToPolicies(page: Page) {
  const attests = page.locator('input[id^="attends-"]');
  for (let i = 0; i < (await attests.count()); i++) {
    const box = attests.nth(i);
    if (!(await box.isChecked())) await box.check();
  }
  const consent = page.locator("#consent");
  if (!(await consent.isChecked())) await consent.check();
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
