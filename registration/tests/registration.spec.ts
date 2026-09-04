import { test, expect, type Page } from "@playwright/test";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, onnotice: () => {} });

test.afterAll(async () => {
  await sql.end();
});

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/**
 * Stripe's hosted checkout, paid with the standard test card.
 *
 * The hosted page presents payment methods as an accordion with nothing
 * selected, so the card fields do not exist in the DOM until Card is chosen.
 * The radio sits under a full-row click overlay that reports itself as
 * offscreen, so check it directly rather than clicking the row.
 *
 * Email is not an input here: it is passed as customer_email when the session
 * is created, and the hosted page renders it as read-only text.
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

test("a parent registers two children, pays, and the webhook confirms it", async ({ page }) => {
  const email = `${unique("parent")}@example.test`;
  const lastName = unique("Kim").replace(/-/g, "");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /register your keiki/i })).toBeVisible();

  // Register into the class the brief describes: Tuesdays 3 to 4pm, 12 seats.
  const card = page.locator("article", { hasText: "Scratch Adventures" });
  await card.getByRole("link", { name: "Register" }).click();
  await expect(page.getByRole("heading", { name: "Scratch Adventures" })).toBeVisible();

  await page.getByLabel("Your name").fill("Kai Parent");
  await page.getByLabel("Email").fill(email);

  await page.getByLabel("First name").fill("Noa");
  await page.getByLabel("Last name").fill(lastName);
  await page.getByLabel("Date of birth").fill("2017-04-02");

  // Second child in the same submission: one order, two seats, one payment.
  await page.getByRole("button", { name: "Add another child" }).click();
  await page.locator("#fn-1").fill("Leo");
  await page.locator("#ln-1").fill(lastName);
  await page.locator("#dob-1").fill("2019-08-11");

  const before = await sql<{ seats_taken: number }[]>`
    select seats_taken from class_offerings where title = 'Scratch Adventures'`;

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
    select seats_taken from class_offerings where title = 'Scratch Adventures'`;
  expect(after[0].seats_taken).toBe(before[0].seats_taken + 2);

  const holds = await sql<{ n: number }[]>`
    select count(*)::int as n from seat_holds h
      join order_items oi on oi.id = h.order_item_id
     where oi.order_id = ${order.id}`;
  expect(holds[0].n).toBe(0);
});

test("submitting the same registration twice creates one order, not two", async ({
  request,
}) => {
  const [cls] = await sql<{ id: string }[]>`
    select id from class_offerings where title = 'Python Starters'`;

  const payload = {
    idempotencyKey: unique("idem"),
    parent: { email: `${unique("twice")}@example.test`, fullName: "Double Clicker" },
    registrations: [
      {
        classOfferingId: cls.id,
        child: { firstName: "Mia", lastName: unique("Lee").replace(/-/g, ""), dateOfBirth: "2016-02-20" },
      },
    ],
  };

  const before = await sql<{ seats_taken: number }[]>`
    select seats_taken from class_offerings where id = ${cls.id}`;

  // Fired together, the way a double click actually arrives.
  const [a, b] = await Promise.all([
    request.post("/api/register", { data: payload }),
    request.post("/api/register", { data: payload }),
  ]);

  expect(a.ok()).toBeTruthy();
  expect(b.ok()).toBeTruthy();
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
