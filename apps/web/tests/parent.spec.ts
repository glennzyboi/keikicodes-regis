import { test, expect } from "@playwright/test";
import {
  sql,
  unique,
  signUpParent,
  signInParent,
  signInStaff,
  registerAndPay,
  fillRegistration,
  payWithTestCard,
  agreeToPolicies,
  freeClass,
  externalClass,
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
    await page.goto("/dashboard");
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
  test("a card carries the decision, and the detail has its own page", async ({ page }) => {
    // A class with room, so the page carries a register link rather than the
    // disabled state a full class shows.
    const open = await freeClass(1);
    await page.goto(`/schools/${open.school_slug}`);

    // The card used to be a disclosure that expanded in place, which made the
    // grid ragged and reflowed everything below whenever anybody opened one.
    // Now the summary is what you decide on and the detail is a page, because a
    // class is a thing parents send each other and a modal has no address.
    const card = page.locator(".kc-tile-shell", { hasText: open.title }).first();
    await expect(card.getByRole("link", { name: "Register", exact: true })).toBeVisible();

    await card.locator("a.kc-tile-title").click();
    await expect(page).toHaveURL(/\/programs\//);

    // The detail carries what the card does not.
    await expect(page.getByText("Runs", { exact: true })).toBeVisible();
    await expect(page.getByText("Class size", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Register for this class/ })).toBeVisible();
  });

  test("the seat counts on the page match the database", async ({ page }) => {
    // One campus, every class on it. Checking all fifteen campuses would be
    // fifteen page loads to prove the same thing once.
    const [campus] = await sql<{ slug: string }[]>`
      select s.slug
        from class_offerings c join schools s on s.id = c.school_id
       where c.status = 'published' and c.registration_mode = 'keiki_coders'
       group by s.slug
       order by count(*) desc
       limit 1`;

    await page.goto(`/schools/${campus.slug}`);

    const classes = await sql<{ title: string; capacity: number; seats_taken: number }[]>`
      select c.title, c.capacity, c.seats_taken
        from class_offerings c join schools s on s.id = c.school_id
       where c.status = 'published' and s.slug = ${campus.slug}
         and c.registration_mode = 'keiki_coders'`;

    expect(classes.length, "the campus has classes to check").toBeGreaterThan(0);

    for (const c of classes) {
      const left = c.capacity - c.seats_taken;
      const card = page.locator(".kc-tile-shell", { hasText: c.title }).first();
      const expected = left <= 0 ? "Full" : left === 1 ? "1 seat left" : `${left} seats left`;
      await expect(card.getByText(expected, { exact: true }).first(), `${c.title} seat count`)
        .toBeVisible();
    }
  });

  test("a class the school enrols has no way to pay for it here", async ({ page }) => {
    const ext = await externalClass();
    await page.goto(`/schools/${ext.school_slug}`);

    const card = page.locator(".kc-tile-shell", { hasText: ext.title }).first();

    // No Register button anywhere on it, and a link to the school instead.
    await expect(card.getByRole("link", { name: "Register", exact: true })).toHaveCount(0);
    await expect(card.getByText(`Enrolled through ${ext.school}`)).toBeVisible();
    await expect(card.getByRole("link", { name: "Go to the school" })).toBeVisible();

    // The class page says the same thing, since that is the address somebody
    // is most likely to be sent.
    await card.locator("a.kc-tile-title").click();
    await expect(page.getByRole("link", { name: /Register for this class/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: new RegExp("Register at") })).toBeVisible();

    // And walking straight to the registration URL says so rather than 404ing
    // or, worse, taking a payment.
    await signUpParent(page, `${unique("ext")}@example.test`, "External Family");
    await page.goto(`/register/${ext.id}`);
    await expect(page.getByText(/takes registrations for this class/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue to payment/ })).toHaveCount(0);
  });

  test("add another class is optional, and clashing classes are disabled", async ({ page }) => {
    await signUpParent(page, `${unique("optional")}@example.test`);

    // Their real catalogue happens to have no two sellable classes clashing at
    // one campus, so the pair is built rather than hoped for. This used to
    // skip, which meant the feature went unproven every single run while the
    // suite reported green.
    const base = await freeClass(1);
    const clashTitle = unique("Overlapping").replace(/-/g, " ");
    const [other] = await sql<{ id: string }[]>`
      insert into class_offerings
        (school_id, program_id, term_id, title, weekday, start_time, end_time,
         first_session_date, last_session_date, capacity, price_cents,
         status, registration_opens_at, registration_mode)
      select school_id, program_id, term_id, ${clashTitle},
             weekday, start_time + interval '15 minutes', end_time + interval '15 minutes',
             first_session_date, last_session_date, 10, 30000,
             'published', now() - interval '1 day', 'keiki_coders'
        from class_offerings where id = ${base.id}
      returning id`;
    await sql`select * from generate_sessions(${other.id})`;

    const clashing = [{ a: base.id, b_title: clashTitle }];
    const [{ really }] = await sql<{ really: boolean }[]>`
      select classes_clash(${base.id}, ${other.id}) as really`;
    expect(really, "the pair really does overlap").toBe(true);

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

    await sql`delete from class_offerings where id = ${other.id}`;
  });

  test("the date field types, advances, pastes and clamps", async ({ page }) => {
    await signUpParent(page, `${unique("dates")}@example.test`);
    const cls = await freeClass(1);
    await page.goto(`/register/${cls.id}`);

    const parts = page.locator(".df-parts").first();
    const day = parts.locator(".df-d");
    const month = parts.locator(".df-m");
    const year = parts.locator(".df-y");

    // Partial input survives. Publishing an empty ISO used to feed back and
    // blank the box that had just been filled.
    await day.fill("30");
    await expect(day).toHaveValue("30");

    // Two digits move you on without a click, which is the whole point of
    // typing over choosing.
    await day.focus();
    await day.press("Backspace");
    await day.press("Backspace");
    await day.pressSequentially("07");
    await expect(month).toBeFocused();

    // A single digit that cannot be the start of anything else also moves on:
    // there is no month starting with 4.
    await month.pressSequentially("4");
    await expect(year).toBeFocused();

    // Backspace at the start of a box steps back to the previous one.
    await year.press("Backspace");
    await expect(month).toBeFocused();

    // February cannot have 30 days, and the clamp happens once both are known.
    await day.fill("30");
    await month.fill("02");
    await year.fill("2015");
    expect(
      Number(await day.inputValue()),
      "February cannot have 30 days",
    ).toBeLessThanOrEqual(28);

    // People paste dates. All three boxes fill from one.
    await day.fill("");
    await month.fill("");
    await year.fill("");
    await day.focus();
    await page.evaluate(() => {
      const el = document.querySelector(".df-parts .df-d") as HTMLInputElement;
      const data = new DataTransfer();
      data.setData("text", "05/05/2016");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
    });
    await expect(day).toHaveValue("05");
    await expect(month).toHaveValue("05");
    await expect(year).toHaveValue("2016");

    // And it says back what it understood, so a mistyped birthday is visible.
    await expect(parts.locator("xpath=following-sibling::*").first()).toContainText("5 May 2016");
  });
});

test.describe("the parent dashboard", () => {
  test("calendar and details views, and a filter per child", async ({ page }) => {
    const email = `${unique("portal")}@example.test`;
    await signUpParent(page, email, "Portal Family");

    // Two children in one class, so the filter has something to do.
    const cls = await freeClass(2);

    await page.goto(`/register/${cls.id}`);
    await page.locator("#parent-phone").fill("808-555-0111");
    await fillRegistration(page, 0, { first: "Alpha", last: "Portal", dob: "2016-01-01" }, cls);
    await page.getByRole("button", { name: "Add another child" }).click();
    await fillRegistration(page, 1, { first: "Beta", last: "Portal", dob: "2018-01-01" }, cls);
    await agreeToPolicies(page);

    await page.getByRole("button", { name: "Continue to payment" }).click();
    // Was a third hand-written copy of the card driver. There is one now, in
    // helpers, which is why moving checkout into an iframe was a single edit
    // rather than three that had to be kept in step.
    await payWithTestCard(page);
    await page.waitForURL(/\/confirming/, { timeout: 45_000 });
    await expect(page.getByRole("heading", { name: /your keiki are/i })).toBeVisible({
      timeout: 45_000,
    });

    await page.goto("/dashboard");

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
    await page.getByRole("button", { name: "My classes" }).click();
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
    const { classId } = await registerAndPay(page, target, {
      first: "Cancelme",
      last: unique("Kid").replace(/-/g, ""),
      dob: "2015-05-05",
    });

    const [before] = await sql<{ seats_taken: number }[]>`
      select seats_taken from class_offerings where id = ${classId}`;

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "My classes" }).click();
    await page.locator(".exp-card-summary").first().click();
    await page.getByRole("button", { name: "Request cancellation" }).first().click();

    // The dialog refuses to send without a reason, which is the point of it.
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.locator(".mdl-panel [role=alert]")).toContainText("choose a reason");

    await page.locator(".mdl-panel select").selectOption("schedule_conflict");
    await page.locator(".mdl-panel textarea").fill("Swim training moved to Tuesdays.");
    await page.getByRole("button", { name: "Send request" }).click();
    await page.waitForTimeout(2000);

    const [enrollment] = await sql<{ status: string; refund_owed: boolean }[]>`
      select e.status, e.refund_owed from enrollments e
        join children ch on ch.id = e.child_id
        join parents p on p.id = ch.parent_id
       where p.email = ${email}`;
    expect(enrollment.status).toBe("cancellation_requested");
    expect(enrollment.refund_owed).toBe(true);

    // The reason is the new part, and it has to be countable, not free text.
    const [why] = await sql<
      { cancellation_reason_code: string; cancellation_note: string }[]
    >`select e.cancellation_reason_code, e.cancellation_note from enrollments e
        join children ch on ch.id = e.child_id
        join parents p on p.id = ch.parent_id
       where p.email = ${email}`;
    expect(why.cancellation_reason_code).toBe("schedule_conflict");
    expect(why.cancellation_note).toContain("Swim training");

    // The seat is still theirs. That is the whole point of a request.
    const [after] = await sql<{ seats_taken: number }[]>`
      select seats_taken from class_offerings where id = ${classId}`;
    expect(after.seats_taken, "the seat must not be released yet").toBe(before.seats_taken);

    // And the portal says so rather than pretending it is done.
    await page.reload();
    await page.getByRole("button", { name: "My classes" }).click();
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
    const { classId } = await registerAndPay(page, cycleClass, {
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
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "My classes" }).click();
    await page.locator(".exp-card-summary").first().click();
    await page.getByRole("button", { name: "Request cancellation" }).first().click();
    await page.locator(".mdl-panel select").selectOption("cost");
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
