import { test, expect } from "@playwright/test";
import { sql, unique, signInStaff, signUpParent, registerAndPay, freeClass } from "./helpers";
import { PER_PAGE } from "../src/app/admin/ui";

/**
 * Every console tab, exercised rather than merely loaded.
 *
 * A page returning 200 proves almost nothing. These assert that the numbers on
 * screen match the database, that the controls do what they claim, and that the
 * effect is visible afterwards.
 */

test.describe("overview", () => {
  test("the stats and the capacity table agree with the database", async ({ page }) => {
    await signInStaff(page);
    await page.goto("/admin");

    const [truth] = await sql<
      { enrolled: number; capacity: number; classes: number }[]
    >`select
        (select count(*)::int from enrollments
          where status in ('active','cancellation_requested')) as enrolled,
        (select coalesce(sum(capacity), 0)::int from class_offerings
          where status = 'published') as capacity,
        (select count(*)::int from class_offerings where status = 'published') as classes`;

    // "N of M seats filled" under booked revenue.
    await expect(
      page.getByText(new RegExp(`${truth.enrolled} of ${truth.capacity} seats filled`)),
    ).toBeVisible();

    // The capacity table pages at ten now, so it shows a page rather than every
    // class. What has to stay true is that the totals above it come from the
    // whole database and not from the rows on screen: summing the rendered
    // array is precisely the bug this replaced, and it made "Collected" on the
    // Money page wrong past its two hundredth order.
    const rows = page.locator("#capacity table.ops-table tbody tr");
    await expect(rows).toHaveCount(Math.min(truth.classes, PER_PAGE));
    await expect(page.locator("#capacity .ops-pager")).toContainText(`of ${truth.classes}`);

    // And the first page holds anything that does not reconcile, because a
    // dashboard should lead with what needs doing.
    const [drift] = await sql<{ n: number }[]>`
      select count(*)::int as n from class_offerings c
       where c.status = 'published'
         and (select count(*)::int from enrollments e
               where e.class_offering_id = c.id
                 and e.status in ('active','cancellation_requested'))
           + (select count(*)::int from seat_holds h where h.class_offering_id = c.id)
           <> c.seats_taken`;
    if (drift.n > 0 && drift.n <= PER_PAGE) {
      await expect(page.locator("#capacity").getByText("drift").first()).toBeVisible();
    }

    // The chart rendered as real SVG with real coordinates, not an empty box.
    // Asserted by attribute rather than visibility: a week with the same count
    // every day draws a flat line, whose bounding box has zero height, which
    // Playwright correctly calls invisible.
    const chartLine = page.locator("figure svg polyline");
    await expect(chartLine).toHaveCount(1);
    const points = await chartLine.getAttribute("points");
    expect(points?.split(" ").length, "the chart should plot every day").toBeGreaterThan(10);
  });

  test("the activity feed shows real audit rows", async ({ page }) => {
    await signInStaff(page);
    await page.goto("/admin");

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from enrollment_events`;

    if (n > 0) {
      await expect(page.locator(".ops-feed-item").first()).toBeVisible();
    } else {
      await expect(page.getByText("Nothing yet")).toBeVisible();
    }
  });
});

test.describe("money", () => {
  test("all four sub tabs open and carry their own content", async ({ page }) => {
    await signInStaff(page);

    const tabs: [string, RegExp][] = [
      ["unconfirmed", /Paid, not confirmed/],
      ["cancellations", /(No open requests|Decline, keep the place)/],
      ["refunds", /(Nothing to refund|Refunds)/],
      ["ledger", /Every order/],
    ];

    for (const [tab, marker] of tabs) {
      await page.goto(`/admin/money?tab=${tab}`);
      await expect(page.getByText(marker).first(), `${tab} content`).toBeVisible();
      // The tab is marked current, so the URL and the UI agree.
      await expect(page.locator(`a[href="/admin/money?tab=${tab}"][data-chosen="true"]`)).toBeVisible();
    }
  });

  test("collected matches the sum of paid orders", async ({ page }) => {
    await signInStaff(page);
    await page.goto("/admin/money");

    const [{ collected }] = await sql<{ collected: number }[]>`
      select coalesce(sum(amount_cents), 0)::int as collected
        from orders where status = 'paid'`;

    const formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(collected / 100);

    await expect(page.getByText(formatted).first()).toBeVisible();
  });

  test("a ledger row expands to the full detail", async ({ page }) => {
    await signInStaff(page);
    await page.goto("/admin/money?tab=ledger");

    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from orders`;
    test.skip(n === 0, "no orders to expand");

    const first = page.locator(".exp-summary").first();
    // Closed to begin with.
    await expect(page.locator(".exp-detail")).toHaveCount(0);
    await expect(first).toHaveAttribute("aria-expanded", "false");

    await first.click();
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Order id")).toBeVisible();
    await expect(page.getByText("Charged")).toBeVisible();

    // And it closes again.
    await first.click();
    await expect(first).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("families and students", () => {
  test("search finds a family by parent name, email and child name", async ({ page, context }) => {
    // Make a family with a known, unusual child name.
    const email = `${unique("searchable")}@example.test`;
    const childLast = unique("Kaeo").replace(/-/g, "");
    await signUpParent(page, email, "Searchable Parent");
    const roomy = await freeClass(1);
    await registerAndPay(page, roomy, {
      first: "Findme",
      last: childLast,
      dob: "2015-07-07",
    });

    await context.clearCookies();
    await signInStaff(page);

    for (const term of ["Searchable", email.split("@")[0], "Findme"]) {
      await page.goto(`/admin/families?q=${encodeURIComponent(term)}`);
      await expect(
        page.getByRole("link", { name: "Searchable Parent" }),
        `searching "${term}" should find the family`,
      ).toBeVisible();
    }

    // A term that matches nothing says so rather than showing everyone.
    await page.goto("/admin/families?q=zzzznotarealfamilyzzzz");
    await expect(page.getByText("Nobody matches")).toBeVisible();
  });

  test("the family page shows keiki, registrations, payments and messages", async ({
    page,
    context,
  }) => {
    const email = `${unique("detail")}@example.test`;
    await signUpParent(page, email, "Detail Family");
    const target = await freeClass(1);
    await registerAndPay(page, target, {
      first: "Detailed",
      last: unique("Kid").replace(/-/g, ""),
      dob: "2014-03-03",
    });

    const [parent] = await sql<{ id: string }[]>`
      select id from parents where email = ${email}`;

    await context.clearCookies();
    await signInStaff(page);
    await page.goto(`/admin/families/${parent.id}`);

    await expect(page.getByRole("heading", { name: "Detail Family" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Keiki" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Registrations" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Payment history" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What we sent them" })).toBeVisible();

    // The registration and its payment are both there.
    await expect(page.getByText("Detailed").first()).toBeVisible();
    await expect(page.getByRole("link", { name: target.title })).toBeVisible();

    // Fulfilment queued a confirmation, so the messages panel is not empty.
    await expect(page.getByText("registration confirmed").first()).toBeVisible();
  });

  test("a medical note is surfaced on the students tab", async ({ page, context }) => {
    const email = `${unique("allergy")}@example.test`;
    await signUpParent(page, email, "Allergy Family");

    const [cls] = await sql<{ id: string; grade: number }[]>`
      select id, coalesce(grade_min, 3) as grade from class_offerings
       where seats_taken < capacity and registration_mode = 'keiki_coders'
       limit 1`;
    const last = unique("Nut").replace(/-/g, "");

    const res = await page.request.post("/api/register", {
      data: {
        idempotencyKey: unique("allergy"),
        agreedToPolicies: true,
        registrations: [
          {
            classOfferingId: cls.id,
            attendsSchoolConfirmed: true,
            child: {
              firstName: "Peanut",
              lastName: last,
              dateOfBirth: "2016-06-06",
              grade: cls.grade,
              inAfterschoolCare: false,
              notes: "Severe peanut allergy, carries an EpiPen",
            },
          },
        ],
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();

    await context.clearCookies();
    await signInStaff(page);
    await page.goto(`/admin/students?q=Peanut`);

    await expect(page.getByText("Severe peanut allergy, carries an EpiPen")).toBeVisible();
  });
});

test.describe("classes", () => {
  test("class detail shows roster, schedule and payments, and the numbers reconcile", async ({
    page,
  }) => {
    await signInStaff(page);

    const [cls] = await sql<
      { id: string; title: string; enrolled: number; held: number; seats_taken: number }[]
    >`select c.id, c.title, c.seats_taken,
             (select count(*)::int from enrollments e
               where e.class_offering_id = c.id
                 and e.status in ('active','cancellation_requested')) as enrolled,
             (select count(*)::int from seat_holds h where h.class_offering_id = c.id) as held
        from class_offerings c
       where c.seats_taken > 0
       limit 1`;

    test.skip(!cls, "no class with anyone in it");

    // The roster, the calendar and the money are tabs on the class now rather
    // than three sections stacked down one very long page. The header that says
    // which class you are looking at is on every one of them, which is the part
    // worth asserting: several campuses run classes with identical titles.
    await page.goto(`/admin/classes/${cls.id}`);
    await expect(page.getByRole("heading", { name: cls.title })).toBeVisible();

    for (const [tab, heading] of [
      ["roster", "Roster"],
      ["schedule", "Schedule"],
      ["money", "Orders"],
    ] as const) {
      await page.goto(`/admin/classes/${cls.id}/${tab}`);
      await expect(page.getByRole("heading", { name: cls.title }), tab).toBeVisible();
      await expect(page.getByRole("heading", { name: heading }), tab).toBeVisible();
    }

    // Enrolled plus held equals seats taken, and the page says so.
    expect(cls.enrolled + cls.held).toBe(cls.seats_taken);
    await page.goto(`/admin/classes/${cls.id}`);
    await expect(page.getByText("does not reconcile")).toHaveCount(0);

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from sessions where class_offering_id = ${cls.id}`;
    expect(n).toBeGreaterThan(0);

    // Every session is on the schedule tab, which is the one that has to hold
    // all of them rather than the first page of them.
    await page.goto(`/admin/classes/${cls.id}/schedule`);
    await expect(page.locator("table.ops-table tbody tr")).toHaveCount(n);
  });

  test("cancelling a session marks it and emails everyone enrolled", async ({ page }) => {
    await signInStaff(page);

    // A class with people in it, and a session still to come.
    const [target] = await sql<
      { class_id: string; title: string; session_id: string; enrolled: number }[]
    >`select c.id as class_id, c.title, s.id as session_id,
             (select count(*)::int from enrollments e
               where e.class_offering_id = c.id
                 and e.status in ('active','cancellation_requested')) as enrolled
        from class_offerings c
        join sessions s on s.class_offering_id = c.id
       where s.status = 'scheduled' and s.starts_at >= now()
         and exists (select 1 from enrollments e
                      where e.class_offering_id = c.id
                        and e.status in ('active','cancellation_requested'))
       order by s.starts_at asc
       limit 1`;

    test.skip(!target, "no upcoming session with anyone enrolled");

    const before = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications where template = 'session_cancelled'`;

    await page.goto(`/admin/classes/${target.class_id}/schedule`);

    // Tick that exact date. The unit of work is a selection now, not a button
    // that acts on whatever happens to be next, so the row has to be addressed
    // by id: "the first checkbox on the page" is week one, which has already
    // happened, and the test would cancel the wrong afternoon and then assert
    // about a session nobody touched.
    await page.locator(`tr[data-session="${target.session_id}"] input[type=checkbox]`).check();
    await page.getByRole("button", { name: /^Cancel (it|them)$/ }).click();

    // A reason is required, from a fixed list, so the office can count them.
    const dialog = page.getByRole("dialog");
    await dialog.locator("select[name=reasonCode]").selectOption("holiday");
    await dialog.locator("textarea[name=note]").fill("Automated test, holiday closure.");
    await page.getByRole("button", { name: "Cancel these dates" }).click();
    await expect(page.locator(".ops-note-good")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);

    // The session really is cancelled.
    const [session] = await sql<
      { status: string; note: string; cancel_reason_code: string }[]
    >`select status, note, cancel_reason_code from sessions where id = ${target.session_id}`;
    expect(session.status).toBe("cancelled");
    expect(session.note).toBe("Automated test, holiday closure.");
    expect(session.cancel_reason_code, "the reason is recorded, not just the note").toBe(
      "holiday",
    );

    // And who did it, which nothing recorded before.
    const [event] = await sql<{ event: string; actor: string }[]>`
      select e.event, st.full_name as actor
        from session_events e join staff st on st.id = e.actor_id
       where e.session_id = ${target.session_id} and e.event = 'cancelled'`;
    expect(event?.actor).toBeTruthy();

    // And one notice per enrolled family was queued in the same transaction.
    const after = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications where template = 'session_cancelled'`;
    expect(after[0].n).toBe(before[0].n + target.enrolled);

    // The console shows it as cancelled.
    await page.reload();
    await expect(page.getByText("Automated test, holiday closure.")).toBeVisible();
  });

  test("a transfer moves the seat without overselling", async ({ page }) => {
    await signInStaff(page);

    const [enrollment] = await sql<
      { id: string; class_offering_id: string; child_name: string }[]
    >`select e.id, e.class_offering_id,
             ch.first_name || ' ' || ch.last_name as child_name
        from enrollments e
        join children ch on ch.id = e.child_id
       where e.status = 'active'
       limit 1`;
    test.skip(!enrollment, "nothing to transfer");

    const [destination] = await sql<{ id: string; title: string; seats_taken: number }[]>`
      select id, title, seats_taken from class_offerings
       where id <> ${enrollment.class_offering_id}
         and seats_taken < capacity
         and not classes_clash(id, ${enrollment.class_offering_id})
       limit 1`;
    test.skip(!destination, "no free destination class");

    const [originBefore] = await sql<{ seats_taken: number }[]>`
      select seats_taken from class_offerings where id = ${enrollment.class_offering_id}`;

    await page.goto(`/admin/classes/${enrollment.class_offering_id}/roster`);

    // Scope everything to this child's row. Every row has its own Move button
    // and its own form, so an unscoped locator can open one row and submit
    // another.
    const row = page.locator("tr", { hasText: enrollment.child_name }).first();
    await row.getByRole("button", { name: "Move" }).click();

    const form = row.locator("form");
    await form.locator('select[name="toClassId"]').selectOption(destination.id);
    await expect(form.locator('select[name="toClassId"]')).toHaveValue(destination.id);
    await form.getByRole("button", { name: "Move", exact: true }).click();
    await page.waitForTimeout(2500);

    const [moved] = await sql<{ class_offering_id: string }[]>`
      select class_offering_id from enrollments where id = ${enrollment.id}`;
    expect(moved.class_offering_id, `should be in ${destination.title}`).toBe(destination.id);

    // One seat left the origin, one arrived at the destination, and neither
    // exceeded capacity.
    const [originAfter] = await sql<{ seats_taken: number }[]>`
      select seats_taken from class_offerings where id = ${enrollment.class_offering_id}`;
    const [destAfter] = await sql<{ seats_taken: number; capacity: number }[]>`
      select seats_taken, capacity from class_offerings where id = ${destination.id}`;

    expect(originAfter.seats_taken).toBe(originBefore.seats_taken - 1);
    expect(destAfter.seats_taken).toBe(destination.seats_taken + 1);
    expect(destAfter.seats_taken).toBeLessThanOrEqual(destAfter.capacity);

    // The move is on the record, with who did it.
    const [event] = await sql<{ payload: Record<string, unknown> }[]>`
      select payload from enrollment_events
       where enrollment_id = ${enrollment.id} and event = 'transferred'
       order by created_at desc limit 1`;
    expect(event, "a transfer is audited").toBeTruthy();
    expect(event.payload.by).toBe("ops@keikicoders.com");
  });
});

test.describe("the search box", () => {
  test("it finds families, children, classes and campuses", async ({ page }) => {
    // It used to be a div with the words "Search families, classes, orders" and
    // a fake command-K badge, which is worse than nothing: it tells somebody a
    // feature exists and then does not do it.
    const email = `${unique("findme")}@example.test`;
    await signUpParent(page, email, "Findable Ohana");
    const target = await freeClass(1);
    await registerAndPay(page, target, {
      first: "Findable",
      last: unique("Kid").replace(/-/g, ""),
      dob: "2016-02-02",
    });

    await page.context().clearCookies();
    await signInStaff(page);
    await page.goto("/admin");

    await page.locator("button.ops-search").click();
    const input = page.locator(".ops-palette-input input");
    await expect(input).toBeFocused();

    await input.fill("Findable");
    const hits = page.locator(".ops-palette-hit");
    await expect(hits.first()).toBeVisible();

    // The family and the child both, because the question on the phone is
    // never "search the families table". The child ranks first, since a name
    // typed into a search box is usually a person rather than a household.
    const kinds = await hits.locator(".ops-pill").allTextContents();
    expect(kinds, "a child and their family both come back").toEqual(
      expect.arrayContaining(["child", "family"]),
    );
    expect(kinds[0], "the child is first").toBe("child");

    // A class, from the same box.
    await input.fill(target.title.slice(0, 12));
    await expect(page.locator(".ops-palette-hit").first()).toBeVisible();

    // Enter opens the highlighted row.
    await input.press("Enter");
    await expect(page).toHaveURL(/\/admin\/(families|catalogue)\//);
  });

  test("escape closes it and the keyboard opens it", async ({ page }) => {
    await signInStaff(page);
    await page.goto("/admin");

    await page.keyboard.press("Control+k");
    await expect(page.locator(".ops-palette")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(".ops-palette")).toHaveCount(0);
  });

  test("the search endpoint refuses anyone who is not staff", async ({ page, request }) => {
    // It returns children's names and family email addresses, so it is exactly
    // the endpoint somebody would try without signing in.
    const anon = await request.get("/admin/search?q=kealoha");
    expect(anon.status(), "signed out is refused").toBe(401);

    await signUpParent(page, `${unique("nosy")}@example.test`, "Nosy Parent");
    const asParent = await page.request.get("/admin/search?q=kealoha");
    expect(asParent.status(), "a signed in parent is refused too").toBe(401);
  });

  test("a short query returns nothing rather than the whole database", async ({ page }) => {
    await signInStaff(page);
    const res = await page.request.get("/admin/search?q=a");
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).hits).toEqual([]);
  });

  test("a percent sign is a percent sign, not a wildcard", async ({ page }) => {
    await signInStaff(page);
    const res = await page.request.get("/admin/search?q=%25%25%25");
    expect(res.ok()).toBeTruthy();
    // Escaped, so it matches literal percent signs, of which there are none.
    expect((await res.json()).hits).toEqual([]);
  });
});

test.describe("schedule", () => {
  test("the calendar renders real sessions and navigates months", async ({ page }) => {
    await signInStaff(page);
    await page.goto("/admin/schedule");

    // The grid exists with seven day headers.
    await expect(page.locator(".cal-head-cell")).toHaveCount(7);

    const events = page.locator(".cal-event");
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from sessions`;
    if (n > 0) expect(await events.count()).toBeGreaterThan(0);

    const monthBefore = await page.locator(".cal-month").textContent();
    await page.getByRole("button", { name: "Next month" }).click();
    const monthAfter = await page.locator(".cal-month").textContent();
    expect(monthAfter).not.toBe(monthBefore);

    // Today returns to the current month.
    await page.getByRole("button", { name: "Today" }).click();
    await expect(page.locator(".cal-cell[data-today=true]")).toHaveCount(1);
  });

  test("a cancelled session is struck through, not hidden", async ({ page }) => {
    // Holidays are cancelled sessions rather than gaps, so a family can see why
    // there is no class that week. There are plenty in the real catalogue.
    const [cancelled] = await sql<{ month: string }[]>`
      select to_char(session_date, 'YYYY-MM') as month
        from sessions where status = 'cancelled'
       order by session_date limit 1`;
    test.skip(!cancelled, "nothing cancelled yet");

    await signInStaff(page);
    await page.goto("/admin/schedule");

    // The calendar opens on the first month with anything in it, and the first
    // holiday is usually a couple of months later. Page forward to find it,
    // which also proves the month navigation works on real data.
    const marker = page.locator('.cal-event[data-tone="cancelled"]').first();
    for (let i = 0; i < 8; i++) {
      if (await marker.isVisible().catch(() => false)) break;
      await page.getByRole("button", { name: "Next month" }).click();
    }
    await expect(marker).toBeVisible();
  });
});

test.describe("outbox", () => {
  test("filters work and the counts match the database", async ({ page }) => {
    await signInStaff(page);

    for (const status of ["queued", "sent", "failed"]) {
      await page.goto(`/admin/notifications?status=${status}`);
      const [{ n }] = await sql<{ n: number }[]>`
        select count(*)::int as n from notifications where status = ${status}`;

      if (n === 0) {
        await expect(page.getByText("No message matches those filters")).toBeVisible();
      } else {
        await expect(page.locator("table.ops-table tbody tr")).toHaveCount(Math.min(n, 200));
      }
    }
  });

  test("a queued message can be stopped", async ({ page }) => {
    const [queued] = await sql<{ id: string }[]>`
      select id from notifications where status = 'queued' limit 1`;
    test.skip(!queued, "nothing queued to stop");

    await signInStaff(page);
    await page.goto("/admin/notifications?status=queued");
    await page.getByRole("button", { name: "Stop" }).first().click();
    await page.waitForTimeout(2000);

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications where status = 'cancelled'`;
    expect(n).toBeGreaterThan(0);
  });
});

test.describe("seat holds", () => {
  test("a paid order's hold is shown as protected", async ({ page }) => {
    await signInStaff(page);

    // Fabricate the dangerous case: an expired hold on a paid order.
    const [item] = await sql<{ id: string; class_offering_id: string }[]>`
      select oi.id, oi.class_offering_id
        from order_items oi join orders o on o.id = oi.order_id
       where o.status = 'paid'
       limit 1`;
    test.skip(!item, "no paid order");

    await sql`insert into seat_holds (order_item_id, class_offering_id, expires_at)
              values (${item.id}, ${item.class_offering_id}, now() - interval '5 minutes')
              on conflict (order_item_id) do nothing`;

    await page.goto("/admin/holds");

    // The pill on the row, not "protected" anywhere on the page. The loose
    // version of this matched the *option* inside the new State filter, which
    // is hidden while the select is closed, so the assertion failed on a page
    // that was in fact completely correct.
    await expect(page.locator(".ops-table .ops-pill", { hasText: /^protected$/ })).toHaveCount(1);
    await expect(page.getByText(/belong to a paid order/)).toBeVisible();

    await sql`delete from seat_holds where order_item_id = ${item.id}`;
  });
});
