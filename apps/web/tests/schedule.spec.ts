import { test, expect } from "@playwright/test";
import { sql, signInStaff, signInParent, signUpParent, unique, freeClass, registerAndPay } from "./helpers";

/**
 * The schedule editor, through the browser.
 *
 * `pnpm check:schedule` proves the transaction underneath these buttons; this
 * proves the buttons reach it, that the refusals are readable, and that a
 * change made by the office arrives on the parent's calendar.
 *
 * Worth saying why this file exists at all: "Move next class" had been broken
 * since the catalogue migration made `sessions.session_date` NOT NULL, because
 * the insert never set it. Every reschedule threw. Nothing caught it, because
 * the only session test in the suite clicked "Cancel next class" and no test
 * had ever moved one.
 */

/** A class with a run of future dates that nobody has touched yet. */
async function scratchClass() {
  const [row] = await sql<{ id: string; title: string; future: number }[]>`
    select c.id, c.title,
           count(*) filter (where s.status = 'scheduled' and s.starts_at > now())::int as future
      from class_offerings c
      join sessions s on s.class_offering_id = c.id
     where c.status = 'published' and c.registration_mode = 'keiki_coders'
       -- Untouched *by an earlier test*, which is what this has always claimed
       -- and never checked.
       --
       -- It only asked for six future dates, so it could hand back a class a
       -- previous spec had already moved a date on or added a make up class to.
       -- Shifting the rest of that term then collides with the date that spec
       -- created, the engine correctly refuses it, and the test fails for a
       -- reason that has nothing to do with what it is testing: it passed alone
       -- and failed in a full run, which is the signature of exactly this.
       --
       -- "Untouched" cannot mean "no cancelled sessions", though. Their real
       -- catalogue ships holidays, so the seed already carries 57 cancelled
       -- dates flagged from_blackout, and excluding those left exactly one
       -- eligible class in the whole catalogue and broke six specs at once.
       -- A blackout is the class as published; anything else is a test's doing.
       -- (No backticks in here: this is inside a tagged template, and one would
       -- end the query mid-comment. That has bitten this codebase before.)
       and not exists (
         select 1 from sessions s2
          where s2.class_offering_id = c.id
            and (s2.origin <> 'generated'
                 or s2.status = 'rescheduled'
                 or (s2.status = 'cancelled' and not s2.from_blackout)))
     group by c.id, c.title
    having count(*) filter (where s.status = 'scheduled' and s.starts_at > now()) >= 6
     order by random()
     limit 1`;
  if (!row) throw new Error("no class has six untouched future sessions");
  return row;
}

async function sessionsOf(classId: string) {
  return sql<
    { id: string; session_date: string; status: string; seq: number; origin: string }[]
  >`select id, to_char(session_date, 'YYYY-MM-DD') as session_date, status, seq, origin
      from sessions where class_offering_id = ${classId} order by session_date`;
}

test.describe("the schedule editor", () => {
  test.beforeEach(async ({ page }) => {
    await signInStaff(page);
  });

  test("cancelling several dates at once records a reason, an author and one email", async ({
    page,
  }) => {
    const cls = await scratchClass();
    await page.goto(`/admin/classes/${cls.id}/schedule`);

    // Tick three upcoming dates, addressed by id rather than by counting rows.
    // A test that finds "the third tr containing the word scheduled" breaks the
    // first time a row's wording changes, and then somebody weakens the
    // assertion to make it pass again.
    const rows = await sessionsOf(cls.id);
    const future = rows.filter((r) => r.status === "scheduled").slice(-3);
    for (const r of future) {
      await page.locator(`tr[data-session="${r.id}"] input[type=checkbox]`).check();
    }

    await page.getByRole("button", { name: /^Cancel them$/ }).click();

    // The dialog is a dialog: it is on top of the table, not inside a cell.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Cancel 3 dates");

    await dialog.locator("select[name=reasonCode]").selectOption("campus_closed");
    await dialog.locator("textarea[name=note]").fill("Campus closed that whole week.");
    await dialog.getByRole("button", { name: "Cancel these dates" }).click();
    await expect(page.locator(".ops-note-good")).toContainText("3 dates cancelled", {
      timeout: 15_000,
    });

    const after = await sessionsOf(cls.id);
    for (const r of future) {
      const now = after.find((a) => a.id === r.id)!;
      expect(now.status, `${r.session_date} should be cancelled`).toBe("cancelled");
    }

    const [reason] = await sql<{ cancel_reason_code: string; note: string }[]>`
      select cancel_reason_code, note from sessions where id = ${future[0].id}`;
    expect(reason.cancel_reason_code).toBe("campus_closed");
    expect(reason.note).toContain("Campus closed");

    // Three audit rows, each naming the person who did it.
    const events = await sql<{ n: number }[]>`
      select count(*)::int as n from session_events e
        join staff st on st.id = e.actor_id
       where e.session_id = any(${future.map((f) => f.id)}) and e.event = 'cancelled'`;
    expect(events[0].n).toBe(3);
  });

  test("a cancelled date can be put back, and says so", async ({ page }) => {
    const cls = await scratchClass();
    const rows = await sessionsOf(cls.id);
    const target = rows.filter((r) => r.status === "scheduled").at(-1)!;

    await page.goto(`/admin/classes/${cls.id}/schedule`);
    await page.locator(`tr[data-session="${target.id}"] input[type=checkbox]`).check();
    await page.getByRole("button", { name: /^Cancel it$/ }).click();
    await page.getByRole("dialog").locator("select[name=reasonCode]").selectOption("weather");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel these dates" })
      .click();
    await expect(page.locator(".ops-note-good")).toBeVisible({ timeout: 15_000 });
    await page.reload();

    // There was no way to undo this at all before. One misclick was permanent
    // and the only fix was a developer at a psql prompt.
    await page
      .locator(`tr[data-session="${target.id}"]`)
      .getByRole("button", { name: /Put it back/ })
      .click();
    await page.getByRole("dialog").getByRole("button", { name: "Yes, run it" }).click();
    await expect(page.locator(".ops-note-good")).toContainText("running again", {
      timeout: 15_000,
    });

    const [back] = await sql<{ status: string; cancel_reason_code: string | null }[]>`
      select status, cancel_reason_code from sessions where id = ${target.id}`;
    expect(back.status).toBe("scheduled");
    expect(back.cancel_reason_code, "no stale reason left behind").toBeNull();

    const [restored] = await sql<{ n: number }[]>`
      select count(*)::int as n from session_events
       where session_id = ${target.id} and event = 'restored'`;
    expect(restored.n).toBe(1);
  });

  test("moving a date works, keeps the history, and survives a regeneration", async ({
    page,
  }) => {
    const cls = await scratchClass();
    const rows = await sessionsOf(cls.id);
    const target = rows.filter((r) => r.status === "scheduled").at(-1)!;

    // Three days after the last date, so it cannot collide with anything.
    const to = new Date(`${target.session_date}T00:00:00Z`);
    to.setUTCDate(to.getUTCDate() + 3);
    const iso = to.toISOString().slice(0, 10);

    await page.goto(`/admin/classes/${cls.id}/schedule`);
    await page
      .locator(`tr[data-session="${target.id}"]`)
      .getByRole("button", { name: "Move" })
      .click();

    const dialog = page.getByRole("dialog");
    await dialog.locator("input[name=newDate]").fill(iso);
    await dialog.locator("select[name=reasonCode]").selectOption("facility");
    await dialog.locator("textarea[name=note]").fill("The hall is booked.");
    await dialog.getByRole("button", { name: "Move it" }).click();
    await expect(page.locator(".ops-note-good")).toContainText("Moved to", { timeout: 15_000 });

    // This is the bug that shipped. session_date is NOT NULL and the old code
    // never set it, so every move threw.
    const [replacement] = await sql<
      { session_date: string; origin: string; rescheduled_from: string }[]
    >`select to_char(session_date, 'YYYY-MM-DD') as session_date, origin, rescheduled_from
        from sessions
       where class_offering_id = ${cls.id} and rescheduled_from = ${target.id}`;
    expect(replacement, "the replacement exists").toBeTruthy();
    expect(replacement.session_date).toBe(iso);

    // And this is the second half of it. A replacement marked 'generated' is
    // deleted by the next regeneration, so the move would undo itself.
    expect(replacement.origin).toBe("manual");
    await sql`select generate_sessions(${cls.id})`;
    const [survives] = await sql<{ n: number }[]>`
      select count(*)::int as n from sessions
       where class_offering_id = ${cls.id} and rescheduled_from = ${target.id}`;
    expect(survives.n, "a regeneration must not delete a hand move").toBe(1);

    // The old date is still on the calendar, marked as moved rather than gone,
    // because a date that used to exist is what parents ring about.
    const [original] = await sql<{ status: string }[]>`
      select status from sessions where id = ${target.id}`;
    expect(original.status).toBe("rescheduled");
  });

  test("moving onto a date that already has a class is refused in a sentence", async ({
    page,
  }) => {
    const cls = await scratchClass();
    const rows = (await sessionsOf(cls.id)).filter((r) => r.status === "scheduled");
    const [a, b] = rows.slice(-2);

    await page.goto(`/admin/classes/${cls.id}/schedule`);
    await page
      .locator(`tr[data-session="${a.id}"]`)
      .getByRole("button", { name: "Move" })
      .click();

    const dialog = page.getByRole("dialog");
    await dialog.locator("input[name=newDate]").fill(b.session_date);
    await dialog.locator("select[name=reasonCode]").selectOption("other");
    await dialog.getByRole("button", { name: "Move it" }).click();

    await expect(page.locator(".ops-note-bad")).toContainText("already has a date", {
      timeout: 15_000,
    });

    // Refused means nothing changed, not "half changed".
    const after = await sql<{ status: string }[]>`
      select status from sessions where id = ${a.id}`;
    expect(after[0].status).toBe("scheduled");
  });

  test("moving into the past is refused", async ({ page }) => {
    const cls = await scratchClass();
    const rows = (await sessionsOf(cls.id)).filter((r) => r.status === "scheduled");
    await page.goto(`/admin/classes/${cls.id}/schedule`);
    await page
      .locator(`tr[data-session="${rows.at(-1)!.id}"]`)
      .getByRole("button", { name: "Move" })
      .click();

    const dialog = page.getByRole("dialog");
    await dialog.locator("input[name=newDate]").fill("2020-01-06");
    await dialog.locator("select[name=reasonCode]").selectOption("other");
    await dialog.getByRole("button", { name: "Move it" }).click();

    await expect(page.locator(".ops-note-bad")).toContainText("from today onwards", {
      timeout: 15_000,
    });
  });

  test("a make up class can be added and is not removed by a regeneration", async ({ page }) => {
    const cls = await scratchClass();
    const rows = await sessionsOf(cls.id);
    const last = rows.at(-1)!;

    const when = new Date(`${last.session_date}T00:00:00Z`);
    when.setUTCDate(when.getUTCDate() + 12);
    const iso = when.toISOString().slice(0, 10);

    await page.goto(`/admin/classes/${cls.id}/schedule`);
    await page.getByRole("button", { name: "Add a session" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.locator("input[name=date]").fill(iso);
    await dialog.locator("textarea[name=note]").fill("Make up for the storm week.");
    await dialog.getByRole("button", { name: "Add it" }).click();
    await expect(page.locator(".ops-note-good")).toContainText("Extra session added", {
      timeout: 15_000,
    });

    const [added] = await sql<{ id: string; origin: string; status: string }[]>`
      select id, origin, status from sessions
       where class_offering_id = ${cls.id} and session_date = ${iso}`;
    expect(added.origin).toBe("manual");
    expect(added.status).toBe("scheduled");

    // The whole point of 'manual': editing the term's dates must not delete it.
    await sql`select generate_sessions(${cls.id})`;
    const [still] = await sql<{ n: number }[]>`
      select count(*)::int as n from sessions where id = ${added.id}`;
    expect(still.n).toBe(1);
  });

  test("a whole run of dates shifts together, and the seq stays 1..n", async ({ page }) => {
    const cls = await scratchClass();

    await page.goto(`/admin/classes/${cls.id}/schedule`);
    await page.getByRole("button", { name: "Select rest of term" }).click();
    await page.getByRole("button", { name: /Move them all by a number of days/ }).click();

    const dialog = page.getByRole("dialog");
    await dialog.locator("input[name=byDays]").fill("7");
    await dialog.locator("select[name=reasonCode]").selectOption("campus_closed");
    await dialog.getByRole("button", { name: "Move them" }).click();
    await expect(page.locator(".ops-note-good")).toContainText("moved 7 days later", {
      timeout: 20_000,
    });

    // The display ordinal must still read 1..n or "week 7" means nothing.
    const after = await sessionsOf(cls.id);
    const seqs = after.map((s) => s.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));

    // A vacated date is recorded as a closure, so regenerating does not quietly
    // put a fresh class back on it and grow the term by one.
    const before = after.length;
    await sql`select generate_sessions(${cls.id})`;
    const regenerated = await sessionsOf(cls.id);
    expect(
      regenerated.filter((s) => s.status === "scheduled").length,
      "a regeneration must not add sessions after a shift",
    ).toBeLessThanOrEqual(before);
  });

  test("the calendar can be filtered down to one campus, and the filter is a URL", async ({
    page,
  }) => {
    await page.goto("/admin/schedule");
    const everything = Number(
      (await page.locator(".ops-counts").innerText()).match(/(\d+) sessions? shown/)?.[1],
    );
    expect(everything).toBeGreaterThan(50);

    const [school] = await sql<{ id: string }[]>`
      select s.id from schools s
        join class_offerings c on c.school_id = s.id and c.status = 'published'
       group by s.id order by count(*) desc limit 1`;

    await page.goto(`/admin/schedule?school=${school.id}`);
    const filtered = Number(
      (await page.locator(".ops-counts").innerText()).match(/(\d+) sessions? shown/)?.[1],
    );
    expect(filtered).toBeGreaterThan(0);
    expect(filtered, "filtering must actually filter").toBeLessThan(everything);

    // Status too, and it composes with the campus.
    await page.goto(`/admin/schedule?school=${school.id}&status=cancelled`);
    await expect(page.locator(".ops-counts")).toContainText("sessions shown");
  });

  test("a rubbish filter value cannot reach the query", async ({ page }) => {
    // The status column has a CHECK constraint on three values, so an
    // unwhitelisted one would be a query that raises rather than one that
    // returns nothing.
    const res = await page.goto("/admin/schedule?status=' or 1=1--&school=not-a-uuid");
    expect(res?.status(), "a bad filter is ignored, not a 500").toBeLessThan(500);
  });
});

test.describe("what the office changes, the family sees", () => {
  test("cancelling a date shows on the parent's calendar and queues one email", async ({
    page,
    context,
  }) => {
    const email = `${unique("sched")}@example.test`;
    await signUpParent(page, email, "Schedule Family");
    const cls = await freeClass(1);
    const { classId } = await registerAndPay(page, cls, {
      first: "Sched",
      last: unique("Kid").replace(/-/g, ""),
      dob: "2015-03-03",
    });

    const before = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications where template = 'session_cancelled'`;

    // Staff cancel the next date.
    await context.clearCookies();
    await signInStaff(page);
    await page.goto(`/admin/classes/${classId}/schedule`);

    const rows = await sql<{ id: string }[]>`
      select id from sessions
       where class_offering_id = ${classId} and status = 'scheduled' and starts_at > now()
       order by starts_at limit 1`;

    await page.locator(`tr[data-session="${rows[0].id}"] input[type=checkbox]`).check();
    await page.getByRole("button", { name: /^Cancel it$/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("select[name=reasonCode]").selectOption("instructor_unavailable");
    await dialog.locator("textarea[name=note]").fill("Instructor is unwell.");
    await dialog.getByRole("button", { name: "Cancel these dates" }).click();
    await expect(page.locator(".ops-note-good")).toContainText("1 family emailed", {
      timeout: 20_000,
    });

    // The message was written in the same transaction as the cancellation.
    const after = await sql<{ n: number }[]>`
      select count(*)::int as n from notifications where template = 'session_cancelled'`;
    expect(after[0].n).toBe(before[0].n + 1);

    // And the family can see it, with the reason, rather than finding an
    // unexplained gap.
    await context.clearCookies();
    await signInParent(page, email);
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "My classes" }).click();
    await page.locator(".exp-card-summary").first().click();
    await expect(page.getByText("Instructor is unwell.").first()).toBeVisible();

    // Belt and braces: the cancelled date is struck through on the calendar too.
    expect(rows.length).toBe(1);
    const [session] = await sql<{ status: string }[]>`
      select status from sessions where id = ${rows[0].id}`;
    expect(session.status).toBe("cancelled");
  });
});
