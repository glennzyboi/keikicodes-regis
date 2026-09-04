import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import postgres from "postgres";

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
  await page.waitForURL(/\/portal/, { timeout: 30_000 });
}

/**
 * The date field is three selects rather than one input, because a native date
 * picker makes entering a birthday ten years back into a paging exercise.
 */
async function fillDate(page: Page, index: number, iso: string) {
  const [year, month, day] = iso.split("-");
  const block = page.locator(".df-parts").nth(index);
  await block.locator("select").nth(0).selectOption(month);
  await block.locator("select").nth(1).selectOption(day);
  await block.locator("select").nth(2).selectOption(year);
}

/**
 * Stripe's hosted checkout, paid with the standard test card.
 *
 * The hosted page presents payment methods as an accordion with nothing
 * selected, so the card fields do not exist in the DOM until Card is chosen.
 * The radio sits under a full-row click overlay that reports itself as
 * offscreen, so check it directly rather than clicking the row.
 */
async function payWithTestCard(page: Page) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 });

  await page.getByRole("radio", { name: "Card" }).check({ force: true });
  const cardNumber = page.getByPlaceholder("1234 1234 1234 1234");
  await expect(cardNumber).toBeVisible();

  await cardNumber.fill("4242424242424242");
  await page.getByPlaceholder("MM / YY").fill("12/30");
  await page.getByPlaceholder("CVC").fill("123");

  const name = page.getByPlaceholder("Full name on card");
  if (await name.isVisible().catch(() => false)) await name.fill("Kai Parent");

  const zip = page.getByPlaceholder("ZIP");
  if (await zip.isVisible().catch(() => false)) await zip.fill("96814");

  await page.getByTestId("hosted-payment-submit-button").click();
}

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
  await page.goto(`/schools/${target.school_slug}`);

  // The card opens to reveal the full detail and the register link, so the
  // spec goes through the same disclosure a parent does.
  const card = page.locator(".exp-card", { hasText: target.title }).first();
  await card.locator(".exp-card-summary").click();
  await card.getByRole("link", { name: /Register for/ }).click();
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

  // Every required tick: the campus attestation per child, and the consent.
  const required = page.locator('input[type="checkbox"][required]');
  for (let i = 0; i < (await required.count()); i++) await required.nth(i).check();

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
