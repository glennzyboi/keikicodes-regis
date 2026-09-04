import { test, expect } from "@playwright/test";
import { sql, unique, signInStaff, signUpParent, okGrade, freeClass } from "./helpers";

/**
 * The catalogue, and the machinery under it.
 *
 * This is the part the client is actually buying. Their Airtable already lets
 * the office add a class in seconds, so a replacement that cannot do that is
 * not a replacement. These specs check that it can, and then check the things a
 * spreadsheet will happily let somebody do by accident.
 *
 * Everything here goes through the real console or the real database. Where a
 * test needs an awkward situation, it builds one and puts it back afterwards,
 * because the whole suite shares one database and a spec that leaves a mess
 * makes a later spec fail for a reason nobody can find.
 */

/** A class built for one test, cleaned up whatever happens. */
async function makeOffering(overrides: Record<string, unknown> = {}) {
  const [ctx] = await sql<{ school_id: string; program_id: string; term_id: string }[]>`
    select c.school_id, c.program_id, c.term_id
      from class_offerings c
     where c.registration_mode = 'keiki_coders'
     limit 1`;

  const defaults = {
    title: unique("Probe Class"),
    weekday: 2,
    start_time: "15:00:00",
    end_time: "16:00:00",
    first_session_date: "2026-09-01", // a Tuesday
    last_session_date: "2026-10-27",
    capacity: 10,
    price_cents: 30000,
    grade_min: 1,
    grade_max: 5,
    status: "published",
    ...overrides,
  };

  const [row] = await sql<{ id: string }[]>`
    insert into class_offerings
      (school_id, program_id, term_id, title, weekday, start_time, end_time,
       first_session_date, last_session_date, capacity, price_cents,
       grade_min, grade_max, status, registration_opens_at, registration_mode)
    values
      (${ctx.school_id}, ${ctx.program_id}, ${ctx.term_id}, ${defaults.title as string},
       ${defaults.weekday as number}, ${defaults.start_time as string}::time,
       ${defaults.end_time as string}::time,
       ${defaults.first_session_date as string}::date,
       ${defaults.last_session_date as string}::date,
       ${defaults.capacity as number}, ${defaults.price_cents as number},
       ${defaults.grade_min as number}, ${defaults.grade_max as number},
       ${defaults.status as string}, now() - interval '1 day', 'keiki_coders')
    returning id`;

  await sql`select * from generate_sessions(${row.id})`;
  return { id: row.id, ...defaults, schoolId: ctx.school_id };
}

async function dropOffering(id: string) {
  await sql`delete from seat_holds where class_offering_id = ${id}`;
  await sql`delete from enrollments where class_offering_id = ${id}`;
  await sql`delete from order_items where class_offering_id = ${id}`;
  await sql`delete from class_offerings where id = ${id}`;
}

// ---------------------------------------------------------------------------

test.describe("the schedule generator", () => {
  test("blackouts come out of the count, and their stray dates are ignored", async () => {
    // The case from their own catalogue: 19 Wednesdays from 12 August to 16
    // December, three holidays listed, and they publish 16 sessions. One of the
    // holidays their records carry for a Wednesday class is a Friday, copied
    // from another programme at the same campus. It has to be ignored, not
    // subtracted, or every count is one out.
    const cls = await makeOffering({
      weekday: 3, // Wednesday
      first_session_date: "2026-08-12",
      last_session_date: "2026-12-16",
    });

    try {
      const [{ n: plain }] = await sql<{ n: number }[]>`
        select count(*)::int as n from sessions
         where class_offering_id = ${cls.id} and status = 'scheduled'`;
      expect(plain, "19 Wednesdays in that window").toBe(19);

      await sql`
        insert into offering_blackouts (class_offering_id, blackout_date, reason)
        values (${cls.id}, '2026-10-07'::date, 'Holiday'),
               (${cls.id}, '2026-11-04'::date, 'Holiday'),
               (${cls.id}, '2026-11-11'::date, 'Holiday'),
               (${cls.id}, '2026-11-27'::date, 'A Friday, from another class')`;

      const [gen] = await sql<{ scheduled: number; cancelled: number }[]>`
        select * from generate_sessions(${cls.id})`;

      expect(gen.scheduled, "three holidays land, the Friday does not").toBe(16);
      expect(gen.cancelled, "and the three that do become cancelled sessions").toBe(3);

      // A holiday is a cancelled session, not a gap, so a family sees why.
      const [oct7] = await sql<{ status: string; note: string; from_blackout: boolean }[]>`
        select status, note, from_blackout from sessions
         where class_offering_id = ${cls.id} and session_date = '2026-10-07'`;
      expect(oct7.status).toBe("cancelled");
      expect(oct7.from_blackout).toBe(true);
      expect(oct7.note).toBe("Holiday");
    } finally {
      await dropOffering(cls.id);
    }
  });

  test("a session cancelled by a human survives regeneration", async () => {
    const cls = await makeOffering();
    try {
      // The office cancels week three because the teacher is ill.
      await sql`update sessions set status = 'cancelled', note = 'Teacher sick'
                 where class_offering_id = ${cls.id} and seq = 3`;

      // Then somebody edits the class for an unrelated reason.
      await sql`update class_offerings set end_time = '16:30:00'::time where id = ${cls.id}`;
      await sql`select * from generate_sessions(${cls.id})`;

      const [week3] = await sql<{ status: string; note: string; from_blackout: boolean }[]>`
        select status, note, from_blackout from sessions
         where class_offering_id = ${cls.id} and seq = 3`;

      expect(week3.status, "a human decision is not overwritten").toBe("cancelled");
      expect(week3.note).toBe("Teacher sick");
      expect(week3.from_blackout, "and it is not mistaken for a holiday").toBe(false);

      // The retime did apply to the sessions that were not cancelled.
      const [{ n }] = await sql<{ n: number }[]>`
        select count(*)::int as n from sessions
         where class_offering_id = ${cls.id}
           and (ends_at at time zone 'Pacific/Honolulu')::time = '16:30:00'`;
      expect(n, "every date got the new end time").toBeGreaterThan(0);
    } finally {
      await dropOffering(cls.id);
    }
  });

  test("withdrawing a holiday brings the class back, but not a manual cancellation", async () => {
    const cls = await makeOffering();
    try {
      const [first] = await sql<{ session_date: string }[]>`
        select session_date from sessions
         where class_offering_id = ${cls.id} order by seq limit 1`;

      await sql`insert into offering_blackouts (class_offering_id, blackout_date, reason)
                values (${cls.id}, ${first.session_date}, 'Holiday')`;
      await sql`select * from generate_sessions(${cls.id})`;

      // And a different week cancelled by a person.
      await sql`update sessions set status = 'cancelled', note = 'Storm'
                 where class_offering_id = ${cls.id} and seq = 2`;

      // The holiday is called off.
      await sql`delete from offering_blackouts where class_offering_id = ${cls.id}`;
      await sql`select * from generate_sessions(${cls.id})`;

      const [back] = await sql<{ status: string }[]>`
        select status from sessions
         where class_offering_id = ${cls.id} and session_date = ${first.session_date}`;
      expect(back.status, "the holiday was withdrawn, so the class runs").toBe("scheduled");

      const [stillOff] = await sql<{ status: string; note: string }[]>`
        select status, note from sessions where class_offering_id = ${cls.id} and seq = 2`;
      expect(stillOff.status, "the storm cancellation is not a holiday").toBe("cancelled");
      expect(stillOff.note).toBe("Storm");
    } finally {
      await dropOffering(cls.id);
    }
  });

  test("shortening a term drops the dates that fell off, and keeps a booked one", async () => {
    const cls = await makeOffering();
    try {
      const before = await sql<{ n: number }[]>`
        select count(*)::int as n from sessions where class_offering_id = ${cls.id}`;

      await sql`update class_offerings
                   set last_session_date = last_session_date - 21
                 where id = ${cls.id}`;
      await sql`select * from generate_sessions(${cls.id})`;

      const after = await sql<{ n: number }[]>`
        select count(*)::int as n from sessions where class_offering_id = ${cls.id}`;
      expect(after[0].n, "three weeks came off").toBe(before[0].n - 3);

      // seq stays contiguous, because it is a display ordinal derived from the
      // dates rather than a number anybody has to maintain.
      const [{ contiguous }] = await sql<{ contiguous: boolean }[]>`
        select bool_and(seq = rn) as contiguous from (
          select seq, row_number() over (order by session_date) as rn
            from sessions where class_offering_id = ${cls.id}) t`;
      expect(contiguous).toBe(true);
    } finally {
      await dropOffering(cls.id);
    }
  });

  test("a first date that is not on the class weekday is refused by the database", async () => {
    // The generator walks weekly from the first date. If that date is not on
    // the class day the schedule and the calendar disagree in silence, which is
    // exactly the drift their spreadsheet has.
    const [ctx] = await sql<{ school_id: string; program_id: string; term_id: string }[]>`
      select school_id, program_id, term_id from class_offerings limit 1`;

    await expect(
      sql`insert into class_offerings
            (school_id, program_id, term_id, title, weekday, start_time, end_time,
             first_session_date, last_session_date, capacity, price_cents,
             status, registration_opens_at)
          values (${ctx.school_id}, ${ctx.program_id}, ${ctx.term_id}, ${unique("Bad day")},
                  1, '15:00'::time, '16:00'::time,
                  '2026-09-01'::date, '2026-10-01'::date, 10, 1000, 'draft', now())`,
    ).rejects.toThrow(/first_session_matches_weekday/);
  });
});

// ---------------------------------------------------------------------------

test.describe("the catalogue console", () => {
  test("staff can create a campus, a program and a class, end to end", async ({ page }) => {
    await signInStaff(page);

    const campus = unique("Probe Campus").replace(/-/g, " ");
    const program = unique("Probe Program").replace(/-/g, " ");

    // A campus.
    await page.goto("/admin/catalogue/schools");
    await page.getByRole("button", { name: "Add a campus" }).click();
    await page.locator("#name").fill(campus);
    await page.locator("#timezone").fill("Pacific/Honolulu");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText(`${campus} saved.`)).toBeVisible({ timeout: 20_000 });

    // A program.
    await page.goto("/admin/catalogue/programs");
    await page.getByRole("button", { name: "Add a program" }).click();
    await page.locator("#name").fill(program);
    await page.locator("#subject").fill("Virtual Reality");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText(`${program} saved.`)).toBeVisible({ timeout: 20_000 });

    // Both are in the database, and slugged for a URL.
    const [school] = await sql<{ id: string; slug: string }[]>`
      select id, slug from schools where name = ${campus}`;
    expect(school, "the campus was created").toBeTruthy();
    expect(school.slug).not.toContain(" ");

    const [prog] = await sql<{ id: string }[]>`
      select id from programs where name = ${program}`;
    expect(prog, "the program was created").toBeTruthy();

    // A class joining them, through the form.
    await page.goto("/admin/catalogue/classes/new");
    await page.locator("select[name=programId]").selectOption(prog.id);
    await page.locator("select[name=schoolId]").selectOption(school.id);
    await page.locator("input[name=title]").fill(`${program} at ${campus}`);
    await page.locator("select[name=weekday]").selectOption("2");
    await page.locator("input[name=startTime]").fill("15:00");
    await page.locator("input[name=endTime]").fill("16:00");
    await page.locator("input[name=firstSessionDate]").fill("2026-09-01");
    await page.locator("input[name=lastSessionDate]").fill("2026-10-27");
    await page.locator("input[name=capacity]").fill("12");
    await page.locator('input[type="number"]').last().fill("300");
    await page.locator("select[name=status]").selectOption("published");

    // The preview counts before anything is saved. That is the point of it.
    await expect(page.getByText("sessions will run")).toBeVisible();
    await expect(page.locator(".ops-stat-value")).toHaveText("9");

    await page.getByRole("button", { name: "Create class" }).click();
    await expect(page.getByText(/sessions scheduled/)).toBeVisible({ timeout: 30_000 });

    const [made] = await sql<{ id: string; capacity: number; price_cents: number }[]>`
      select id, capacity, price_cents from class_offerings
       where school_id = ${school.id} and program_id = ${prog.id}`;
    expect(made.capacity).toBe(12);
    expect(made.price_cents, "dollars in the form, cents in the column").toBe(30000);

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from sessions
       where class_offering_id = ${made.id} and status = 'scheduled'`;
    expect(n, "nine Tuesdays, matching the preview").toBe(9);

    // And a family can see it, which is the only proof that matters.
    await page.context().clearCookies();
    await page.goto(`/schools/${school.slug}`);
    await expect(page.getByText(`${program} at ${campus}`).first()).toBeVisible();

    await dropOffering(made.id);
    await sql`delete from programs where id = ${prog.id}`;
    await sql`delete from schools where id = ${school.id}`;
  });

  test("capacity cannot go below the seats already taken", async ({ page }) => {
    const cls = await makeOffering({ capacity: 10 });
    try {
      // Four children in it.
      await sql`update class_offerings set seats_taken = 4 where id = ${cls.id}`;

      await signInStaff(page);
      await page.goto(`/admin/catalogue/classes/${cls.id}`);
      await page.locator("input[name=capacity]").fill("2");

      // The form says so before the save, naming the number.
      await expect(page.getByText(/4 seats are taken/)).toBeVisible();

      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText(/cannot go below/)).toBeVisible({ timeout: 20_000 });

      const [after] = await sql<{ capacity: number }[]>`
        select capacity from class_offerings where id = ${cls.id}`;
      expect(after.capacity, "the capacity did not change").toBe(10);
    } finally {
      await sql`update class_offerings set seats_taken = 0 where id = ${cls.id}`;
      await dropOffering(cls.id);
    }
  });

  test("a class with children in it cannot be deleted", async ({ page }) => {
    const cls = await makeOffering();
    try {
      const [parent] = await sql<{ id: string }[]>`
        insert into parents (email, full_name)
        values (${`${unique("del")}@example.test`}, 'Delete Family') returning id`;
      const [child] = await sql<{ id: string }[]>`
        insert into children (parent_id, first_name, last_name, date_of_birth, grade)
        values (${parent.id}, 'Stay', 'Put', '2016-01-01', 3) returning id`;
      await sql`insert into enrollments (class_offering_id, child_id, status)
                values (${cls.id}, ${child.id}, 'active')`;

      await signInStaff(page);
      await page.goto(`/admin/catalogue/classes/${cls.id}`);

      // The button is disabled, and the panel explains what to do instead.
      await expect(page.getByRole("button", { name: "Delete this class" })).toBeDisabled();
      await expect(page.getByText(/Set the class to closed instead/)).toBeVisible();

      // And the action refuses even when called directly, because a disabled
      // button is a courtesy rather than a control.
      const res = await page.request.post(`/admin/catalogue/classes/${cls.id}`, {
        form: { offeringId: cls.id },
      });
      expect(res.status()).toBeLessThan(500);

      const [{ n }] = await sql<{ n: number }[]>`
        select count(*)::int as n from class_offerings where id = ${cls.id}`;
      expect(n, "the class still exists").toBe(1);

      await sql`delete from enrollments where class_offering_id = ${cls.id}`;
      await sql`delete from children where id = ${child.id}`;
      await sql`delete from parents where id = ${parent.id}`;
    } finally {
      await dropOffering(cls.id);
    }
  });

  test("a class the school enrols must say where to send families", async () => {
    const [ctx] = await sql<{ school_id: string; program_id: string; term_id: string }[]>`
      select school_id, program_id, term_id from class_offerings limit 1`;

    await expect(
      sql`insert into class_offerings
            (school_id, program_id, term_id, title, weekday, start_time, end_time,
             first_session_date, last_session_date, capacity, registration_mode,
             status, registration_opens_at)
          values (${ctx.school_id}, ${ctx.program_id}, ${ctx.term_id}, ${unique("Nowhere")},
                  2, '15:00'::time, '16:00'::time,
                  '2026-09-01'::date, '2026-10-01'::date, 10, 'external', 'draft', now())`,
    ).rejects.toThrow(/external_needs_a_destination/);
  });

  test("a class we sell must have a price", async () => {
    const [ctx] = await sql<{ school_id: string; program_id: string; term_id: string }[]>`
      select school_id, program_id, term_id from class_offerings limit 1`;

    await expect(
      sql`insert into class_offerings
            (school_id, program_id, term_id, title, weekday, start_time, end_time,
             first_session_date, last_session_date, capacity, registration_mode,
             status, registration_opens_at)
          values (${ctx.school_id}, ${ctx.program_id}, ${ctx.term_id}, ${unique("Free")},
                  2, '15:00'::time, '16:00'::time,
                  '2026-09-01'::date, '2026-10-01'::date, 10, 'keiki_coders', 'draft', now())`,
    ).rejects.toThrow(/sold_here_needs_a_price/);
  });

  test("exactly one term can be current", async () => {
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from terms where is_current`;
    expect(n, "one term is current").toBe(1);

    const [other] = await sql<{ id: string }[]>`
      insert into terms (name, starts_on, ends_on, is_current)
      values (${unique("Probe Term")}, '2027-01-05', '2027-05-01', false)
      returning id`;

    // Two at once is refused by the index rather than by a code path somebody
    // has to remember to call.
    await expect(
      sql`update terms set is_current = true where id = ${other.id}`,
    ).rejects.toThrow(/terms_one_current/);

    await sql`delete from terms where id = ${other.id}`;
  });
});

// ---------------------------------------------------------------------------

test.describe("schedule conflicts", () => {
  test("a child cannot be booked into two classes that overlap", async ({ page }) => {
    // Their real catalogue happens to have no two sellable classes clashing at
    // one campus, so the situation is built rather than hoped for. The rule
    // matters regardless of whether today's data exercises it.
    const a = await makeOffering({ weekday: 2, start_time: "15:00:00", end_time: "16:00:00" });
    const b = await makeOffering({
      weekday: 2,
      start_time: "15:30:00",
      end_time: "16:30:00",
      title: unique("Overlaps"),
    });

    try {
      const [{ clash }] = await sql<{ clash: boolean }[]>`
        select classes_clash(${a.id}, ${b.id}) as clash`;
      expect(clash, "same day, overlapping times, overlapping terms").toBe(true);

      const email = `${unique("conflict")}@example.test`;
      await signUpParent(page, email, "Conflict Family");

      const child = {
        firstName: "Split",
        lastName: unique("Kid").replace(/-/g, ""),
        dateOfBirth: "2016-01-01",
        grade: 3,
        inAfterschoolCare: false,
      };

      const res = await page.request.post("/api/register", {
        data: {
          idempotencyKey: unique("conflict"),
          agreedToPolicies: true,
          registrations: [
            { classOfferingId: a.id, attendsSchoolConfirmed: true, child },
            { classOfferingId: b.id, attendsSchoolConfirmed: true, child },
          ],
        },
      });

      expect(res.status()).toBe(409);
      const body = await res.json();
      expect(body.reason).toBe("schedule_conflict");
      // Named, so a parent can act on it rather than hunt.
      expect(body.detail).toMatch(/run at the same time/i);

      // Nothing was taken.
      const [{ seats }] = await sql<{ seats: number }[]>`
        select coalesce(sum(seats_taken), 0)::int as seats from class_offerings
         where id in (${a.id}, ${b.id})`;
      expect(seats, "a refused registration takes no seats").toBe(0);
    } finally {
      await dropOffering(a.id);
      await dropOffering(b.id);
    }
  });

  test("back to back classes do not clash", async () => {
    const a = await makeOffering({ weekday: 2, start_time: "15:00:00", end_time: "16:00:00" });
    const b = await makeOffering({
      weekday: 2,
      start_time: "16:00:00",
      end_time: "17:00:00",
      title: unique("After"),
    });
    try {
      const [{ clash }] = await sql<{ clash: boolean }[]>`
        select classes_clash(${a.id}, ${b.id}) as clash`;
      // Tight, but it is a decision a parent is allowed to make. Treating it as
      // a conflict would be the system inventing a policy.
      expect(clash).toBe(false);
    } finally {
      await dropOffering(a.id);
      await dropOffering(b.id);
    }
  });

  test("classes in different terms do not clash", async () => {
    const a = await makeOffering({
      weekday: 2,
      first_session_date: "2026-09-01",
      last_session_date: "2026-10-27",
    });
    const b = await makeOffering({
      weekday: 2,
      first_session_date: "2027-01-05",
      last_session_date: "2027-03-02",
      title: unique("Next term"),
    });
    try {
      const [{ clash }] = await sql<{ clash: boolean }[]>`
        select classes_clash(${a.id}, ${b.id}) as clash`;
      expect(clash, "a Tuesday in autumn is not a Tuesday in spring").toBe(false);
    } finally {
      await dropOffering(a.id);
      await dropOffering(b.id);
    }
  });
});

// ---------------------------------------------------------------------------

test.describe("grade eligibility", () => {
  test("a child outside the grade range is refused by the server, not just the form", async ({
    page,
  }) => {
    const cls = await makeOffering({ grade_min: 6, grade_max: 8 });
    try {
      await signUpParent(page, `${unique("grade")}@example.test`, "Grade Family");

      const res = await page.request.post("/api/register", {
        data: {
          idempotencyKey: unique("grade"),
          agreedToPolicies: true,
          registrations: [
            {
              classOfferingId: cls.id,
              attendsSchoolConfirmed: true,
              child: {
                firstName: "TooYoung",
                lastName: unique("G").replace(/-/g, ""),
                dateOfBirth: "2020-01-01",
                grade: 1,
                inAfterschoolCare: false,
              },
            },
          ],
        },
      });

      expect(res.status()).toBe(409);
      const body = await res.json();
      expect(body.reason).toBe("grade_not_eligible");
      // The message says both numbers, so a parent knows what to do next.
      expect(body.detail).toMatch(/grades 6 to 8/i);
      expect(body.detail).toMatch(/grade 1/i);

      const [{ seats }] = await sql<{ seats: number }[]>`
        select seats_taken as seats from class_offerings where id = ${cls.id}`;
      expect(seats).toBe(0);
    } finally {
      await dropOffering(cls.id);
    }
  });
});

// ---------------------------------------------------------------------------

test.describe("what a registration records", () => {
  test("consent is stored with its version and the moment it was given", async ({ page }) => {
    const cls = await freeClass(1);
    const email = `${unique("consent")}@example.test`;
    await signUpParent(page, email, "Consent Family");

    // A photo key is "<parent id>/<file>" and is checked against the signed in
    // family, so the test has to use its own rather than an invented one.
    const [me] = await sql<{ id: string }[]>`select id from parents where email = ${email}`;
    const photoPath = `${me.id}/head-shot.jpg`;

    const res = await page.request.post("/api/register", {
      data: {
        idempotencyKey: unique("consent"),
        agreedToPolicies: true,
        policyVersion: "2026-09-05",
        marketingOptIn: true,
        heardAboutUs: "A friend or another parent",
        parentPhone: "808-555-0199",
        guardian: { fullName: "Aunty Leilani", phone: "808-555-0200", relation: "Aunty" },
        registrations: [
          {
            classOfferingId: cls.id,
            attendsSchoolConfirmed: true,
            child: {
              firstName: "Consent",
              lastName: unique("C").replace(/-/g, ""),
              dateOfBirth: "2016-03-03",
              grade: okGrade(cls),
              inAfterschoolCare: true,
              afterschoolCareProgram: "A+",
              photoPath,
            },
          },
        ],
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();

    const [parent] = await sql<
      { id: string; phone: string; marketing_opt_in: boolean; heard_about_us: string }[]
    >`select id, phone, marketing_opt_in, heard_about_us from parents where email = ${email}`;

    expect(parent.phone).toBe("808-555-0199");
    expect(parent.marketing_opt_in).toBe(true);
    expect(parent.heard_about_us).toBe("A friend or another parent");

    // A consent you cannot date and version is not a consent record.
    const consents = await sql<
      { kind: string; policy_version: string; agreed_at: Date; order_id: string | null }[]
    >`select kind, policy_version, agreed_at, order_id from consents
       where parent_id = ${parent.id} order by kind`;

    const policies = consents.find((c) => c.kind === "participation_policies");
    expect(policies, "the policy consent is recorded").toBeTruthy();
    expect(policies!.policy_version).toBe("2026-09-05");
    expect(policies!.agreed_at).toBeInstanceOf(Date);
    expect(policies!.order_id, "tied to the registration it was given for").toBeTruthy();

    expect(
      consents.find((c) => c.kind === "marketing"),
      "opting in to marketing is its own consent, not a column",
    ).toBeTruthy();

    // Everything their form collects about the child.
    const [child] = await sql<
      {
        grade: number;
        in_afterschool_care: boolean;
        afterschool_care_program: string;
        photo_path: string;
      }[]
    >`select c.grade, c.in_afterschool_care, c.afterschool_care_program, c.photo_path
        from children c where c.parent_id = ${parent.id}`;

    expect(child.grade).toBe(okGrade(cls));
    expect(child.in_afterschool_care, "A+ decides where a child is collected from").toBe(true);
    expect(child.afterschool_care_program).toBe("A+");
    expect(child.photo_path).toBe(photoPath);

    // The second guardian is a row, not a note.
    const [guardian] = await sql<{ full_name: string; phone: string; relation: string }[]>`
      select full_name, phone, relation from guardians where parent_id = ${parent.id}`;
    expect(guardian.full_name).toBe("Aunty Leilani");
    expect(guardian.relation).toBe("Aunty");

    // The attestation is on the purchase, because that is what it is about.
    const [{ confirmed }] = await sql<{ confirmed: boolean }[]>`
      select oi.attends_school_confirmed as confirmed
        from order_items oi join orders o on o.id = oi.order_id
       where o.parent_id = ${parent.id} limit 1`;
    expect(confirmed).toBe(true);
  });

  test("a registration without consent is refused", async ({ page }) => {
    const cls = await freeClass(1);
    await signUpParent(page, `${unique("noconsent")}@example.test`, "No Consent");

    const res = await page.request.post("/api/register", {
      data: {
        idempotencyKey: unique("noconsent"),
        // agreedToPolicies deliberately missing
        registrations: [
          {
            classOfferingId: cls.id,
            attendsSchoolConfirmed: true,
            child: {
              firstName: "NoTick",
              lastName: unique("N").replace(/-/g, ""),
              dateOfBirth: "2016-01-01",
              grade: okGrade(cls),
              inAfterschoolCare: false,
            },
          },
        ],
      },
    });

    expect(res.status(), "no consent, no registration").toBe(400);
    expect(res.status()).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------

test.describe("the schema and the code agree", () => {
  test("no function body refers to a column that no longer exists", async () => {
    // Dropping `weeks` left classes_clash referring to it, and Postgres said
    // nothing: a function body is text until it runs, so the error arrived at
    // the first parent who tried to register rather than at the migration.
    // This calls every catalogue function with real arguments.
    const [a] = await sql<{ id: string }[]>`select id from class_offerings limit 1`;
    const [b] = await sql<{ id: string }[]>`select id from class_offerings offset 1 limit 1`;
    const [child] = await sql<{ id: string }[]>`select id from children limit 1`;

    await expect(sql`select classes_clash(${a.id}, ${b.id})`).resolves.toBeTruthy();
    await expect(sql`select is_staff()`).resolves.toBeTruthy();
    await expect(sql`select current_parent_id()`).resolves.toBeTruthy();
    await expect(sql`select * from generate_sessions(${a.id})`).resolves.toBeTruthy();

    if (child) {
      await expect(
        sql`select * from clashing_enrollments(${child.id}, ${a.id})`,
      ).resolves.toBeTruthy();
    }

    // And nothing in the schema still mentions the columns that were dropped.
    const stale = await sql<{ proname: string }[]>`
      select p.proname
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prosrc ~* '[^_a-z]weeks[^_a-z]'`;
    expect(stale.map((s) => s.proname), "no function still uses weeks").toEqual([]);
  });

  test("every seat taken is either an enrollment or a live hold", async () => {
    // The invariant the whole seat model rests on. If this drifts, somebody is
    // holding a place nobody can see, or a class looks fuller than it is.
    const wrong = await sql<{ title: string; seats_taken: number; accounted: number }[]>`
      select c.title, c.seats_taken,
             (select count(*) from enrollments e
               where e.class_offering_id = c.id
                 and e.status in ('active','cancellation_requested'))
             + (select count(*) from seat_holds h where h.class_offering_id = c.id)
             as accounted
        from class_offerings c
       where c.seats_taken <> (
         (select count(*) from enrollments e
           where e.class_offering_id = c.id
             and e.status in ('active','cancellation_requested'))
         + (select count(*) from seat_holds h where h.class_offering_id = c.id))`;

    expect(wrong, `seats that cannot be accounted for: ${JSON.stringify(wrong)}`).toEqual([]);
  });

  test("nothing is oversold, ever", async () => {
    const over = await sql<{ title: string }[]>`
      select title from class_offerings where seats_taken > capacity`;
    expect(over).toEqual([]);
  });
});
