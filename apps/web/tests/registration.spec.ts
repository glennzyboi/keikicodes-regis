import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import postgres from "postgres";
import { attachPhoto, fillDate, payWithTestCard } from "./helpers";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, onnotice: () => {} });

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/**
 * Create an account through the real signup form.
 *
 * Registration now requires one, so every spec starts here. Going through the
 * form rather than seeding a session means the auth path is covered by every
 * run instead of being the one thing nobody tests.
 */
async function signUp(page: Page, email: string, name = "Test Parent") {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("TestParent!2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

/*
 * `fillDate` is imported from helpers.ts rather than living here.
 *
 * It used to be a local copy, with a comment noting it "used to be a
 * byte-identical copy... which is how it came to be updated in one place and
 * not the other". Keeping the copy and writing that down did not stop it
 * happening again: the date field became three selects, helpers.ts was updated,
 * and this file kept calling .fill() on a <select>. The comment was the fix
 * that was never going to work. Deleting the duplicate is.
 */

test("registration requires an account, and sends you back where you were going", async ({
  page,
}) => {
  const [cls] = await sql<{ id: string; title: string }[]>`
    select id, title from class_offerings
     where status = 'published' and registration_mode = 'keiki_coders'
     limit 1`;

  await page.goto(`/register/${cls.id}`);

  // Bounced to sign in, carrying the destination so the login wall is not a
  // dead end.
  await expect(page).toHaveURL(new RegExp(`/login\\?next=.*${cls.id}`));

  await signUp(page, `${unique("gate")}@example.test`, "Gate Tester");

  await page.goto(`/register/${cls.id}`);
  await expect(page.getByRole("heading", { name: cls.title })).toBeVisible();
  await expect(page.getByText("Signed in")).toBeVisible();
});

test("a parent registers two children, pays, and the webhook confirms it", async ({ page }) => {
  const email = `${unique("parent")}@example.test`;
  const lastName = unique("Kim").replace(/-/g, "");

  await signUp(page, email, "Kai Parent");

  // A class with room for both children, that we actually sell. Hardcoding a
  // title would inherit whatever the specs before this one did to that class.
  const [target] = await sql<{ title: string; grade: number; school_slug: string }[]>`
    select c.title, coalesce(c.grade_min, 3) as grade, s.slug as school_slug
      from class_offerings c join schools s on s.id = c.school_id
     where c.status = 'published' and c.registration_mode = 'keiki_coders'
       and c.capacity - c.seats_taken >= 2
     order by c.capacity - c.seats_taken desc limit 1`;

  // The whole path a family actually walks: the front door asks which school
  // first, because that is the only thing a parent arrives knowing.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /find your keiki/i })).toBeVisible();

  // Browsing and registering are separate tabs now, because they are separate
  // jobs. This walks the browsing one.
  await page.getByRole("link", { name: "Programs", exact: true }).click();
  await expect(page).toHaveURL(/\/programs$/);

  // The school picker is a combobox: type, and the list narrows.
  await page.locator("input[role=combobox]").fill(target.school_slug.split("-")[0]);
  await page.locator(".kc-combo-option").first().click();
  await expect(page).toHaveURL(/\/schools\//);

  // Register is on the card itself. A parent who knows which class they want
  // does not have to open anything first.
  const card = page.locator(".kc-tile-shell", { hasText: target.title }).first();
  await card.getByRole("link", { name: "Register", exact: true }).click();
  await expect(page.getByRole("heading", { name: target.title })).toBeVisible();

  await page.locator("#parent-phone").fill("808-555-0122");
  await page.locator("#fn-0").fill("Noa");
  await page.locator("#ln-0").fill(lastName);
  await page.locator("#grade-0").selectOption(String(target.grade));
  await fillDate(page, 0, "2017-04-02");

  // Second child in the same submission: one order, two seats, one payment.
  // Their form cannot do this at all: a family with two keiki fills it in
  // twice, retypes both parents, and pays twice.
  await page.getByRole("button", { name: "Add another child" }).click();
  await page.locator("#fn-1").fill("Leo");
  await page.locator("#ln-1").fill(lastName);
  await page.locator("#grade-1").selectOption(String(target.grade));
  await fillDate(page, 1, "2019-08-11");

  // Submitting with things missing must say what and where, not just refuse.
  // This is the check that the form guides rather than blocks.
  await page.getByRole("button", { name: "Continue to payment" }).click();
  const summary = page.locator("#kc-error-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("need your attention");
  await expect(summary).toContainText("Agreeing to the policies");
  await expect(page.locator("#consent")).toHaveAttribute("aria-invalid", "true");

  // Every required tick: the campus attestation per child, the head shot their
  // own form also requires, and the consent.
  for (const box of await page.locator('input[id^="attends-"]').all()) await box.check();
  await attachPhoto(page, 0);
  await attachPhoto(page, 1);
  await page.locator("#consent").check();

  // Fixing a field clears its own complaint rather than leaving it up.
  await expect(page.locator("#consent")).toHaveAttribute("aria-invalid", "false");

  // Count by id, not title. The same curriculum runs at five campuses now, so
  // "where title = ..." matches several rows and the arithmetic is nonsense.
  const [{ id: targetId }] = await sql<{ id: string }[]>`
    select c.id from class_offerings c join schools s on s.id = c.school_id
     where c.title = ${target.title} and s.slug = ${target.school_slug}`;

  const before = await sql<{ seats_taken: number }[]>`
    select seats_taken from class_offerings where id = ${targetId}`;

  await page.getByRole("button", { name: "Continue to payment" }).click();
  await payWithTestCard(page);

  // Back on our side. The page must not claim success before the webhook lands.
  await page.waitForURL(/\/confirming/, { timeout: 45_000 });
  await expect(page.getByRole("heading", { name: /your keiki are/i })).toBeVisible({
    timeout: 45_000,
  });

  // And the database has to agree with the screen.
  const [order] = await sql<{ id: string; status: string; fulfilled_at: Date | null }[]>`
    select o.id, o.status, o.fulfilled_at from orders o
      join parents p on p.id = o.parent_id
     where p.email = ${email}`;
  expect(order.status).toBe("paid");
  expect(order.fulfilled_at).not.toBeNull();

  const enrolments = await sql<{ n: number }[]>`
    select count(*)::int as n from enrollments e
      join order_items oi on oi.id = e.order_item_id
     where oi.order_id = ${order.id} and e.status = 'active'`;
  expect(enrolments[0].n).toBe(2);

  // Seats moved by exactly two, and the holds were consumed rather than left behind.
  const after = await sql<{ seats_taken: number }[]>`
    select seats_taken from class_offerings where id = ${targetId}`;
  expect(after[0].seats_taken).toBe(before[0].seats_taken + 2);

  const holds = await sql<{ n: number }[]>`
    select count(*)::int as n from seat_holds h
      join order_items oi on oi.id = h.order_item_id
     where oi.order_id = ${order.id}`;
  expect(holds[0].n).toBe(0);

  // Fulfilment queued the confirmation in the same transaction as the
  // enrollments, so it exists whether or not the mail provider is reachable.
  const queued = await sql<{ n: number }[]>`
    select count(*)::int as n from notifications
     where order_id = ${order.id} and template = 'registration_confirmed'`;
  expect(queued[0].n).toBe(1);
});

test("submitting the same registration twice creates one order, not two", async ({
  page,
  context,
}) => {
  const email = `${unique("twice")}@example.test`;
  await signUp(page, email, "Double Clicker");

  const [cls] = await sql<{ id: string; grade: number }[]>`
    select id, coalesce(grade_min, 3) as grade from class_offerings
     where status = 'published' and registration_mode = 'keiki_coders'
       and capacity - seats_taken >= 1
     order by capacity - seats_taken desc limit 1`;

  const payload = {
    idempotencyKey: unique("idem"),
    agreedToPolicies: true,
    registrations: [
      {
        classOfferingId: cls.id,
        attendsSchoolConfirmed: true,
        child: {
          firstName: "Mia",
          lastName: unique("Lee").replace(/-/g, ""),
          dateOfBirth: "2016-02-20",
          grade: cls.grade,
          inAfterschoolCare: false,
        },
      },
    ],
  };

  const before = await sql<{ seats_taken: number }[]>`
    select seats_taken from class_offerings where id = ${cls.id}`;

  // The signed in browser context, so the request carries the session cookie
  // exactly the way the form would.
  const api: APIRequestContext = context.request;

  // Fired together, the way a double click actually arrives.
  const [a, b] = await Promise.all([
    api.post("/api/register", { data: payload }),
    api.post("/api/register", { data: payload }),
  ]);

  expect(a.ok(), await a.text()).toBeTruthy();
  expect(b.ok(), await b.text()).toBeTruthy();
  const first = await a.json();
  const second = await b.json();
  expect(first.orderId).toBe(second.orderId);

  const orders = await sql<{ n: number }[]>`
    select count(*)::int as n from orders where idempotency_key = ${payload.idempotencyKey}`;
  expect(orders[0].n).toBe(1);

  // One seat, not two. A double click must never cost a family two places.
  const after = await sql<{ seats_taken: number }[]>`
    select seats_taken from class_offerings where id = ${cls.id}`;
  expect(after[0].seats_taken).toBe(before[0].seats_taken + 1);
});

test("a signed out request cannot register anyone", async ({ request }) => {
  const [cls] = await sql<{ id: string }[]>`
    select id from class_offerings limit 1`;

  const res = await request.post("/api/register", {
    data: {
      idempotencyKey: unique("anon"),
      registrations: [
        {
          classOfferingId: cls.id,
          child: { firstName: "Nobody", lastName: "Anon", dateOfBirth: "2015-01-01" },
        },
      ],
    },
  });

  expect(res.status()).toBe(401);
});

/**
 * Checkout happens in the page, and the wallets survived the move.
 *
 * The wallet half is the one worth a test of its own. `Permissions-Policy:
 * payment=()` was in the security headers, denying the Payment Request API to
 * every descendant frame, and that is exactly the API that puts Apple Pay and
 * Google Pay in Stripe's iframe. The failure would have been silent: the card
 * form works perfectly, the wallet buttons simply never render, and a suite that
 * only ever pays by card would report green forever while the phone conversion
 * quietly halved.
 */
test("checkout is embedded in our page, and wallets are still allowed into it", async ({
  page,
}) => {
  const [cls] = await sql<{ id: string; grade: number }[]>`
    select c.id, coalesce(c.grade_min, 3) as grade
      from class_offerings c
     where c.status = 'published' and c.registration_mode = 'keiki_coders'
       and c.capacity - c.seats_taken >= 1
     order by c.capacity - c.seats_taken desc limit 1`;

  await signUp(page, `${unique("embed")}@example.test`, "Embedded Family");
  await page.goto(`/register/${cls.id}`);

  await page.locator("#parent-phone").fill("808-555-0111");
  await page.locator("#fn-0").fill("Embed");
  await page.locator("#ln-0").fill(unique("Keiki").replace(/-/g, ""));
  await page.locator("#grade-0").selectOption(String(cls.grade));
  await fillDate(page, 0, "2016-01-01");
  for (const box of await page.locator('input[id^="attends-"]').all()) await box.check();
  await attachPhoto(page, 0);
  await page.locator("#consent").check();

  await page.getByRole("button", { name: "Continue to payment" }).click();

  // Never leaves our origin.
  await expect(page.locator(".kc-checkout")).toBeVisible({ timeout: 45_000 });
  expect(new URL(page.url()).origin).toBe("http://localhost:3000");
  expect(page.url()).toContain(`/register/${cls.id}`);

  // The header says whose card form this is, because a card field appearing
  // inside somebody else's page is what a phishing attempt looks like too.
  await expect(page.getByText(/Card details go straight to Stripe/)).toBeVisible();

  // The wallet slot exists inside Stripe's frame. Its presence is precisely
  // what `payment=()` used to prevent.
  // Stripe renders more than one of these (the row, and the wallet button
  // inside it), so count rather than match: "at least one" is the claim, and a
  // strict single-element locator fails on the very thing it is checking for.
  const checkout = page.frameLocator('iframe[name="embedded-checkout"]');
  await expect(checkout.getByTestId("express-checkout-element").first()).toBeAttached({
    timeout: 45_000,
  });
  expect(
    await checkout.getByTestId("express-checkout-element").count(),
    "the wallet row must exist inside Stripe's frame",
  ).toBeGreaterThan(0);

  // And the header we actually send grants it rather than denies it.
  const res = await page.request.get(`/register/${cls.id}`);
  const policy = res.headers()["permissions-policy"] ?? "";
  expect(policy, "payment must not be denied outright").not.toContain("payment=()");
  expect(policy, "and Stripe must be named as an allowed origin").toContain(
    "checkout.stripe.com",
  );
});
