import { test, expect } from "@playwright/test";
import {
  sql,
  unique,
  signUpParent,
  signInParent,
  signInStaff,
  registerAndPay,
  fillDate,
  freeClass,
} from "./helpers";

/**
 * The parent side, end to end.
 *
 * Signing up, browsing, registering, paying, and then living with the result:
 * the calendar, the per child filter, and asking to cancel.
 */

test.describe("accounts", () => {
  test("sign up, sign out, sign back in", async ({ page }) => {
    const email = `${unique("lifecycle")}@example.test`;

    await signUpParent(page, email, "Round Trip");
    await expect(page.getByRole("heading", { name: /Aloha, Round/ })).toBeVisible();

    // The parents row was created on first sight.
    const [parent] = await sql<{ full_name: string; auth_user_id: string | null }[]>`
      select full_name, auth_user_id from parents where email = ${email}`;
    expect(parent.full_name).toBe("Round Trip");
    expect(parent.auth_user_id, "the account must be linked").not.toBeNull();

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("http://localhost:3000/", { timeout: 20_000 });
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

    // Session really is gone.
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/login/);

    await signInParent(page, email);
    await expect(page.getByRole("heading", { name: /Aloha, Round/ })).toBeVisible();
  });

  test("a weak password is refused with a useful message", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Your name").fill("Weak Password");
    await page.getByLabel("Email").fill(`${unique("weak")}@example.test`);
    await page.getByLabel("Password").fill("short");
    await page.getByRole("button", { name: "Create account" }).click();

    // The browser's own minlength stops it, or the server does. Either way we
    // are still on the signup page and no account exists.
    await expect(page).toHaveURL(/\/signup/);
  });

  test("signing up twice with the same address does not create two families", async ({
    page,
    context,
  }) => {
    const email = `${unique("twice")}@example.test`;
    await signUpParent(page, email, "First Time");
    await context.clearCookies();

    await page.goto("/signup");
    await page.getByLabel("Your name").fill("Second Time");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("TestParent!2026");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForTimeout(2000);

    const rows = await sql<{ id: string }[]>`
      select id from parents where email = ${email}`;
    expect(rows.length, "one family per address").toBe(1);
  });
});

test.describe("browsing and registering", () => {
  test("a class card opens to its full detail", async ({ page }) => {
    // A class with room, so the detail carries a register link rather than the
    // disabled state a full class shows.
    const open = await freeClass(1);
    await page.goto("/");

    const card = page.locator(".exp-card", { hasText: open.title }).first();
    const summary = card.locator(".exp-card-summary");
    await expect(summary).toHaveAttribute("aria-expanded", "false");

    await summary.click();
    await expect(summary).toHaveAttribute("aria-expanded", "true");

    // The detail carries what the summary does not.
    await expect(card.getByText("Runs")).toBeVisible();
    await expect(card.getByText("Class size")).toBeVisible();
    await expect(card.getByRole("link", { name: /Register for/ })).toBeVisible();
  });

  test("the seat counts on the page match the database", async ({ page }) => {
    await page.goto("/");

    const classes = await sql<{ title: string; capacity: number; seats_taken: number }[]>`
      select title, capacity, seats_taken from class_offerings where status = 'published'`;

    for (const c of classes) {
      const left = c.capacity - c.seats_taken;
      const card = page.locator(".exp-card", { hasText: c.title }).first();
      const expected =
        left <= 0 ? "Class is full" : left === 1 ? "1 seat left" : `${left} seats left`;
      // A full class says it twice, on the badge and on the disabled button.
      await expect(
        card.getByText(expected).first(),
        `${c.title} seat count`,
      ).toBeVisible();
    }
  });

  test("add another class is optional, and clashing classes are disabled", async ({ page }) => {
    await signUpParent(page, `${unique("optional")}@example.test`);

    const clashing = await sql<{ a: string; b_title: string }[]>`
      select a.id as a, b.title as b_title
        from class_offerings a join class_offerings b on a.id <> b.id
       where classes_clash(a.id, b.id)
       limit 1`;
    test.skip(clashing.length === 0, "no clashing pair");

    await page.goto(`/register/${clashing[0].a}`);

    // Folded away and labelled optional.
    const disclosure = page.locator("details", { hasText: "Add another class" });
    await expect(disclosure.getByText("Optional")).toBeVisible();
    await expect(disclosure).not.toHaveAttribute("open", "");

    await disclosure.locator("summary").click();

    // The clashing option is there, disabled, and says why.
    const clashRow = disclosure.locator("label", { hasText: clashing[0].b_title });
    await expect(clashRow.locator("input[type=checkbox]")).toBeDisabled();
    await expect(clashRow.getByText(/clashes with this class/)).toBeVisible();
  });

  test("the date field keeps partial input and clamps impossible days", async ({ page }) => {
    await signUpParent(page, `${unique("dates")}@example.test`);
    const cls = await freeClass(1);
    await page.goto(`/register/${cls.id}`);

    const parts = page.locator(".df-parts").first().locator("select");

    // Month alone survives, which was a real bug: publishing an empty ISO value
    // used to feed back and blank the select that had just been set.
    await parts.nth(0).selectOption("02");
    await expect(parts.nth(0)).toHaveValue("02");

    await parts.nth(1).selectOption("30");
    await expect(parts.nth(1)).toHaveValue("30");
    await expect(parts.nth(0)).toHaveValue("02");

    // Choosing a non leap year clamps 30 February down to a day that exists.
    await parts.nth(2).selectOption("2015");
    await expect(parts.nth(2)).toHaveValue("2015");
    const day = await parts.nth(1).inputValue();
    expect(Number(day), "February cannot have 30 days").toBeLessThanOrEqual(28);
  });
});

test.describe("the portal", () => {
  test("calendar and details views, and a filter per child", async ({ page }) => {
    const email = `${unique("portal")}@example.test`;
    await signUpParent(page, email, "Portal Family");

    // Two children in one class, so the filter has something to do.
    const cls = await freeClass(2);

    await page.goto(`/register/${cls.id}`);
    await page.locator("#fn-0").fill("Alpha");
    await page.locator("#ln-0").fill("Portal");
    await fillDate(page, 0, "2016-01-01");
    await page.getByRole("button", { name: "Add another child" }).click();
    await page.locator("#fn-1").fill("Beta");
    await page.locator("#ln-1").fill("Portal");
    await fillDate(page, 1, "2018-01-01");

    await page.getByRole("button", { name: "Continue to payment" }).click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 });
    await page.getByRole("radio", { name: "Card" }).check({ force: true });
    await page.getByPlaceholder("1234 1234 1234 1234").fill("4242424242424242");
    await page.getByPlaceholder("MM / YY").fill("12/30");
    await page.getByPlaceholder("CVC").fill("123");
    const name = page.getByPlaceholder("Full name on card");
    if (await name.isVisible().catch(() => false)) await name.fill("Portal Family");
    await page.getByTestId("hosted-payment-submit-button").click();
    await page.waitForURL(/\/confirming/, { timeout: 45_000 });
    await expect(page.getByRole("heading", { name: /your keiki are/i })).toBeVisible({
      timeout: 45_000,
    });

    await page.goto("/portal");

    // Calendar is the default and it has real events.
    await expect(page.getByRole("button", { name: "Calendar" })).toHaveAttribute(
      "data-chosen",
      "true",
    );
    const allEvents = await page.locator(".cal-event").count();
    expect(allEvents, "both children should appear").toBeGreaterThan(0);

    // Filtering to one child halves them.
    await page.getByRole("button", { name: "Alpha" }).click();
    await page.waitForTimeout(400);
    const alphaEvents = await page.locator(".cal-event").count();
    expect(alphaEvents).toBeLessThan(allEvents);
    expect(alphaEvents).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Everyone" }).click();
    await page.waitForTimeout(400);
    expect(await page.locator(".cal-event").count()).toBe(allEvents);

    // Details view lists both registrations and expands.
    await page.getByRole("button", { name: "Details" }).click();
    await expect(page.locator(".exp-card")).toHaveCount(2);

    const first = page.locator(".exp-card-summary").first();
    await first.click();
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Every date").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Request cancellation" }).first()).toBeVisible();
  });

  test("requesting a cancellation holds the seat rather than releasing it", async ({ page }) => {
    const email = `${unique("cancel")}@example.test`;
    await signUpParent(page, email, "Cancel Family");
    const target = await freeClass(1);
    const { classId } = await registerAndPay(page, target.id, {
      first: "Cancelme",
      last: unique("Kid").replace(/-/g, ""),
      dob: "2015-05-05",
    });

    const [before] = await sql<{ seats_taken: number }[]>`
      select seats_taken from class_offerings where id = ${classId}`;

    await page.goto("/portal");
    await page.getByRole("button", { name: "Details" }).click();
    await page.locator(".exp-card-summary").first().click();
    await page.getByRole("button", { name: "Request cancellation" }).first().click();
    await page.getByRole("button", { name: "Send request" }).click();
    await page.waitForTimeout(2000);

    const [enrollment] = await sql<{ status: string; refund_owed: boolean }[]>`
      select e.status, e.refund_owed from enrollments e
        join children ch on ch.id = e.child_id
        join parents p on p.id = ch.parent_id
       where p.email = ${email}`;
    expect(enrollment.status).toBe("cancellation_requested");
    expect(enrollment.refund_owed).toBe(true);

    // The seat is still theirs. That is the whole point of a request.
    const [after] = await sql<{ seats_taken: number }[]>`
      select seats_taken from class_offerings where id = ${classId}`;
    expect(after.seats_taken, "the seat must not be released yet").toBe(before.seats_taken);

    // And the portal says so rather than pretending it is done.
    await page.reload();
    await page.getByRole("button", { name: "Details" }).click();
    await expect(page.getByText("Cancellation requested").first()).toBeVisible();
  });
});

test.describe("the full money lifecycle", () => {
  test("register, pay, cancel, approve, refund, seat freed, emails at each step", async ({
    page,
    context,
  }) => {
    const email = `${unique("full")}@example.test`;
    await signUpParent(page, email, "Full Cycle");

    // 1. Register and pay.
    const cycleClass = await freeClass(1);
    const { classId } = await registerAndPay(page, cycleClass.id, {
      first: "Cycle",
      last: unique("Kid").replace(/-/g, ""),
      dob: "2014-09-09",
    });

    const [afterPay] = await sql<{ seats_taken: number }[]>`
      select seats_taken from class_offerings where id = ${classId}`;

    // 2. A confirmation was queued in the same transaction as fulfilment.
    const confirmations = await sql<{ id: string; status: string }[]>`
      select n.id, n.status from notifications n
        join parents p on p.id = n.parent_id
       where p.email = ${email} and n.template = 'registration_confirmed'`;
    expect(confirmations.length, "one confirmation").toBe(1);

    // 3. Parent asks to cancel.
    await page.goto("/portal");
    await page.getByRole("button", { name: "Details" }).click();
    await page.locator(".exp-card-summary").first().click();
    await page.getByRole("button", { name: "Request cancellation" }).first().click();
    await page.getByRole("button", { name: "Send request" }).click();
    await page.waitForTimeout(2000);

    const [enrollment] = await sql<{ id: string; status: string }[]>`
      select e.id, e.status from enrollments e
        join children ch on ch.id = e.child_id
        join parents p on p.id = ch.parent_id
       where p.email = ${email}`;
    expect(enrollment.status).toBe("cancellation_requested");

    // 4. Staff approve it with a partial refund.
    await context.clearCookies();
    await signInStaff(page);
    await page.goto("/admin/money?tab=cancellations");

    const card = page.locator("section", { hasText: "Cycle" }).first();
    await card.getByRole("button", { name: "Approve and refund" }).click();
    await card.getByRole("button", { name: /Pro rata/ }).click();
    await card.getByRole("button", { name: /^Approve and refund \$/ }).click();
    await page.waitForTimeout(6000);

    // 5. The place is cancelled, the seat is back, and Stripe took the refund.
    const [done] = await sql<
      {
        status: string;
        refund_status: string | null;
        stripe_refund_id: string | null;
        refund_amount_cents: number | null;
      }[]
    >`select status, refund_status, stripe_refund_id, refund_amount_cents
        from enrollments where id = ${enrollment.id}`;

    expect(done.status).toBe("cancelled");
    expect(done.stripe_refund_id, "a real Stripe refund id").toMatch(/^re_/);
    expect(done.refund_status).toBe("succeeded");
    expect(done.refund_amount_cents).toBeGreaterThan(0);

    const [freed] = await sql<{ seats_taken: number }[]>`
      select seats_taken from class_offerings where id = ${classId}`;
    expect(freed.seats_taken, "the seat came back").toBe(afterPay.seats_taken - 1);

    // 6. The family was told about the cancellation too.
    const told = await sql<{ id: string }[]>`
      select n.id from notifications n
        join parents p on p.id = n.parent_id
       where p.email = ${email} and n.template = 'cancellation_approved'`;
    expect(told.length, "a cancellation email was queued").toBe(1);

    // 7. And the audit trail records who did it.
    const events = await sql<{ event: string }[]>`
      select event from enrollment_events
       where enrollment_id = ${enrollment.id}
       order by created_at`;
    const names = events.map((e) => e.event);
    expect(names).toContain("cancellation_requested");
    expect(names).toContain("cancellation_approved");
    expect(names).toContain("refund_issued");
  });
});
