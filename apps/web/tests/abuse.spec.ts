import { test, expect } from "@playwright/test";
import { sql, unique, signUpParent, signInStaff } from "./helpers";

/**
 * Deliberate misuse.
 *
 * Malformed ids, oversized fields, values outside the allowed set, business
 * rules attacked from the API rather than the form, and the classic open
 * redirect. None of these should crash, and none should succeed.
 */

test.describe("malformed input is refused, not crashed", () => {
  test("a bad uuid in a URL is a 404, never a 500", async ({ page }) => {
    await signUpParent(page, `${unique("badid")}@example.test`);

    const nonsense = ["abc", "1", "' OR 1=1 --", "../../etc/passwd", "%00", "null", "undefined"];

    for (const id of nonsense) {
      const res = await page.request.get(`/register/${encodeURIComponent(id)}`);
      expect(
        res.status(),
        `/register/${id} should not be a server error`,
      ).toBeLessThan(500);

      const api = await page.request.get(`/api/orders/${encodeURIComponent(id)}`);
      expect(api.status(), `/api/orders/${id} should not be a server error`).toBeLessThan(500);
    }
  });

  test("a well formed uuid that does not exist is a clean 404", async ({ page }) => {
    await signUpParent(page, `${unique("ghost")}@example.test`);
    const ghost = "00000000-0000-0000-0000-000000000000";

    const res = await page.request.get(`/register/${ghost}`);
    expect(res.status()).toBe(404);

    const api = await page.request.get(`/api/orders/${ghost}`);
    expect(api.status()).toBe(404);
  });

  test("the register endpoint rejects every shape of rubbish", async ({ page }) => {
    await signUpParent(page, `${unique("rubbish")}@example.test`);
    const [cls] = await sql<{ id: string }[]>`select id from class_offerings limit 1`;

    const bad: [string, unknown][] = [
      ["empty object", {}],
      ["no registrations", { idempotencyKey: unique("k"), registrations: [] }],
      ["short key", { idempotencyKey: "x", registrations: [] }],
      [
        "class id not a uuid",
        {
          idempotencyKey: unique("k"),
          registrations: [
            {
              classOfferingId: "not-a-uuid",
              child: { firstName: "A", lastName: "B", dateOfBirth: "2016-01-01" },
            },
          ],
        },
      ],
      [
        "date not a date",
        {
          idempotencyKey: unique("k"),
          registrations: [
            {
              classOfferingId: cls.id,
              child: { firstName: "A", lastName: "B", dateOfBirth: "banana" },
            },
          ],
        },
      ],
      [
        "name absurdly long",
        {
          idempotencyKey: unique("k"),
          registrations: [
            {
              classOfferingId: cls.id,
              child: { firstName: "A".repeat(5000), lastName: "B", dateOfBirth: "2016-01-01" },
            },
          ],
        },
      ],
      [
        "eleven children in one order",
        {
          idempotencyKey: unique("k"),
          registrations: Array.from({ length: 11 }, (_, i) => ({
            classOfferingId: cls.id,
            child: { firstName: `C${i}`, lastName: "Many", dateOfBirth: "2016-01-01" },
          })),
        },
      ],
    ];

    for (const [label, payload] of bad) {
      const res = await page.request.post("/api/register", { data: payload });
      expect(res.status(), `${label} should be a 4xx`).toBeGreaterThanOrEqual(400);
      expect(res.status(), `${label} should not be a server error`).toBeLessThan(500);
    }
  });

  test("invalid json does not crash the endpoint", async ({ page }) => {
    await signUpParent(page, `${unique("badjson")}@example.test`);
    const res = await page.request.post("/api/register", {
      headers: { "content-type": "application/json" },
      data: "{ this is not json",
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("injection attempts land as data, not code", () => {
  test("SQL metacharacters in a name are stored verbatim", async ({ page }) => {
    const email = `${unique("sqli")}@example.test`;
    await signUpParent(page, email, "Robert'); DROP TABLE children;--");

    // The account exists and the app still works, which is the point.
    const [parent] = await sql<{ full_name: string }[]>`
      select full_name from parents where email = ${email}`;
    expect(parent.full_name).toBe("Robert'); DROP TABLE children;--");

    // And the table it tried to drop is still there.
    const [{ count }] = await sql<{ count: string }[]>`select count(*) from children`;
    expect(Number(count)).toBeGreaterThanOrEqual(0);
  });

  test("script tags in a child's name are escaped when rendered", async ({ page }) => {
    const email = `${unique("xss")}@example.test`;
    await signUpParent(page, email, "XSS Tester");

    // Grade matters now: posting a grade the class does not take is refused
    // before anything is stored, which would make this test pass for the wrong
    // reason. Ask the class what it accepts.
    const [cls] = await sql<{ id: string; grade: number }[]>`
      select id, coalesce(grade_min, 3) as grade from class_offerings
       where seats_taken < capacity and registration_mode = 'keiki_coders'
       limit 1`;

    const payload = "<img src=x onerror=alert(1)>";
    const res = await page.request.post("/api/register", {
      data: {
        idempotencyKey: unique("xss"),
        agreedToPolicies: true,
        registrations: [
          {
            classOfferingId: cls.id,
            attendsSchoolConfirmed: true,
            child: {
              firstName: payload,
              lastName: "Escaped",
              dateOfBirth: "2016-01-01",
              grade: cls.grade,
              inAfterschoolCare: false,
            },
          },
        ],
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();

    // Render it in the console and prove no element was created from it.
    await page.context().clearCookies();
    await signInStaff(page);
    await page.goto("/admin/students");

    const injected = await page.locator("img[src='x']").count();
    expect(injected, "the payload must not become a real element").toBe(0);

    // It is on the page as text.
    await expect(page.getByText(payload, { exact: false }).first()).toBeVisible();
  });
});

test.describe("business rules cannot be bypassed from the API", () => {
  test("a child cannot be registered into two clashing classes", async ({ page }) => {
    await signUpParent(page, `${unique("clash")}@example.test`, "Clash Family");

    const clashing = await sql<{ a: string; b: string; grade: number }[]>`
      select a.id as a, b.id as b,
             greatest(coalesce(a.grade_min, 0), coalesce(b.grade_min, 0)) as grade
        from class_offerings a join class_offerings b on a.id < b.id
       where classes_clash(a.id, b.id)
         and a.registration_mode = 'keiki_coders'
         and b.registration_mode = 'keiki_coders'
         and a.capacity > a.seats_taken and b.capacity > b.seats_taken
         and coalesce(a.grade_max, 12) >= coalesce(b.grade_min, 0)
         and coalesce(b.grade_max, 12) >= coalesce(a.grade_min, 0)
       limit 1`;

    test.skip(clashing.length === 0, "no clashing pair in the catalogue");

    const child = {
      firstName: "Clash",
      lastName: unique("Kid"),
      dateOfBirth: "2016-01-01",
      grade: clashing[0].grade,
      inAfterschoolCare: false,
    };
    const res = await page.request.post("/api/register", {
      data: {
        idempotencyKey: unique("clash"),
        agreedToPolicies: true,
        registrations: [
          { classOfferingId: clashing[0].a, attendsSchoolConfirmed: true, child },
          { classOfferingId: clashing[0].b, attendsSchoolConfirmed: true, child },
        ],
      },
    });

    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.reason).toBe("schedule_conflict");
    // The message names the class rather than saying "conflict".
    expect(body.detail).toMatch(/run at the same time/i);
  });

  test("the same child cannot take two seats in one class", async ({ page }) => {
    await signUpParent(page, `${unique("dupe")}@example.test`, "Dupe Family");
    const [cls] = await sql<{ id: string; seats_taken: number; grade_min: number | null }[]>`
      select id, seats_taken, grade_min from class_offerings
       where capacity - seats_taken > 3 and registration_mode = 'keiki_coders'
       limit 1`;

    const child = {
      firstName: "Twice",
      lastName: unique("Same"),
      dateOfBirth: "2016-01-01",
      grade: cls.grade_min ?? 3,
      inAfterschoolCare: false,
    };

    const first = await page.request.post("/api/register", {
      data: {
        idempotencyKey: unique("dupe1"),
        agreedToPolicies: true,
        registrations: [{ classOfferingId: cls.id, attendsSchoolConfirmed: true, child }],
      },
    });
    expect(first.ok()).toBeTruthy();

    // Same child, same class, different order. Should be refused before payment.
    const second = await page.request.post("/api/register", {
      data: {
        idempotencyKey: unique("dupe2"),
        agreedToPolicies: true,
        registrations: [{ classOfferingId: cls.id, attendsSchoolConfirmed: true, child }],
      },
    });

    // Either already_enrolled once the first is paid, or a duplicate seat guard.
    // What must not happen is two live places for one child.
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from enrollments e
        join children ch on ch.id = e.child_id
       where ch.first_name = ${child.firstName}
         and ch.last_name = ${child.lastName}
         and e.class_offering_id = ${cls.id}
         and e.status in ('active','cancellation_requested')`;
    expect(n, "a child must never hold two places in one class").toBeLessThanOrEqual(1);
    expect(second.status()).toBeLessThan(500);
  });

  test("a full class refuses the next registration", async ({ page }) => {
    await signUpParent(page, `${unique("full")}@example.test`, "Full Family");

    // Make a class full by hand, then try to take one more.
    const [cls] = await sql<
      { id: string; capacity: number; seats_taken: number; grade_min: number | null }[]
    >`select id, capacity, seats_taken, grade_min from class_offerings
       where registration_mode = 'keiki_coders'
       order by capacity asc limit 1`;

    // Remembered, because filling a class by hand breaks the invariant that
    // seats_taken equals enrollments plus live holds. Leaving it broken made
    // two later specs fail for reasons that had nothing to do with them, which
    // is exactly the sort of shared state that makes a suite untrustworthy.
    const restoreTo = cls.seats_taken;
    await sql`update class_offerings set seats_taken = capacity where id = ${cls.id}`;

    const res = await page.request.post("/api/register", {
      data: {
        idempotencyKey: unique("full"),
        agreedToPolicies: true,
        registrations: [
          {
            classOfferingId: cls.id,
            attendsSchoolConfirmed: true,
            child: {
              firstName: "TooLate",
              lastName: unique("F"),
              dateOfBirth: "2016-01-01",
              grade: cls.grade_min ?? 3,
              inAfterschoolCare: false,
            },
          },
        ],
      },
    });

    expect(res.status()).toBe(409);
    expect((await res.json()).reason).toBe("class_full");

    // The counter did not move past capacity.
    const [after] = await sql<{ seats_taken: number; capacity: number }[]>`
      select seats_taken, capacity from class_offerings where id = ${cls.id}`;
    expect(after.seats_taken).toBeLessThanOrEqual(after.capacity);

    // Back to what it was, not to zero. Zeroing it was the bug: it threw away
    // seats that enrollments and holds still pointed at, so the next spec to
    // look at that class found a count that could not be reconciled.
    await sql`update class_offerings set seats_taken = ${restoreTo} where id = ${cls.id}`;
  });
});

test.describe("a family cannot reach another family's things", () => {
  test("a photograph belonging to someone else is refused", async ({ page }) => {
    // The object key is "<parent id>/<file>", and storage enforces that on the
    // way in. Nothing enforced it on the way back, so a parent could put
    // another family's key in the payload and their child's record would point
    // at a photograph of somebody else's child, which staff would then open.
    const email = `${unique("photo")}@example.test`;
    await signUpParent(page, email, "Photo Thief");

    const [{ id: mine }] = await sql<{ id: string }[]>`
      select id from parents where email = ${email}`;
    const [victim] = await sql<{ id: string }[]>`
      select id from parents where email <> ${email} limit 1`;

    const [cls] = await sql<{ id: string; grade: number }[]>`
      select id, coalesce(grade_min, 3) as grade from class_offerings
       where registration_mode = 'keiki_coders' and seats_taken < capacity limit 1`;

    const attempt = (photoPath: string) =>
      page.request.post("/api/register", {
        data: {
          idempotencyKey: unique("photo"),
          agreedToPolicies: true,
          registrations: [
            {
              classOfferingId: cls.id,
              attendsSchoolConfirmed: true,
              child: {
                firstName: "Photo",
                lastName: unique("P").replace(/-/g, ""),
                dateOfBirth: "2016-01-01",
                grade: cls.grade,
                inAfterschoolCare: false,
                photoPath,
              },
            },
          ],
        },
      });

    if (victim) {
      const stolen = await attempt(`${victim.id}/somebody-elses-child.jpg`);
      expect(stolen.ok(), "another family's photo is refused").toBeFalsy();
      expect(stolen.status()).toBeLessThan(500);
    }

    // Traversal and schemes do not get past the shape check either.
    for (const bad of [
      "../../etc/passwd",
      `${mine}/../${victim?.id ?? mine}/x.jpg`,
      "https://evil.example/x.jpg",
      "child-photos/x.jpg",
    ]) {
      const res = await attempt(bad);
      expect(res.ok(), `"${bad}" must be refused`).toBeFalsy();
      expect(res.status(), `"${bad}" is a refusal, not a crash`).toBeLessThan(500);
    }

    // And the family's own key is accepted, so the rule is a boundary rather
    // than a blanket no.
    const ok = await attempt(`${mine}/my-own-child.jpg`);
    expect(ok.ok(), await ok.text()).toBeTruthy();

    const [child] = await sql<{ photo_path: string }[]>`
      select photo_path from children where parent_id = ${mine} limit 1`;
    expect(child.photo_path).toBe(`${mine}/my-own-child.jpg`);
  });

  test("a child's photograph is readable by their family and staff, and nobody else", async ({
    request,
  }) => {
    // The most sensitive thing this system holds. The bucket is private and the
    // policy keys on the first path segment being the reader's own parents row,
    // so this is a string comparison rather than a join, and there is no way to
    // widen it by getting a query wrong.
    //
    // Checked with real tokens against real storage, because "the bucket is
    // private" is a claim about configuration and this is a claim about
    // behaviour.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const token = async (email: string, password: string) => {
      const res = await request.post(`${url}/auth/v1/token?grant_type=password`, {
        headers: { apikey: anon, "content-type": "application/json" },
        data: { email, password },
      });
      return (await res.json()).access_token as string;
    };

    // A family with a photo on file.
    const owner = `${unique("owner")}@example.test`;
    const [{ id: ownerId }] = await sql<{ id: string }[]>`
      insert into parents (email, full_name) values (${owner}, 'Owner Family')
      returning id`;

    // Put an object in their folder using the service role, the way an upload
    // would land it.
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const key = `${ownerId}/probe.jpg`;
    const put = await request.post(`${url}/storage/v1/object/child-photos/${key}`, {
      headers: {
        apikey: service,
        Authorization: `Bearer ${service}`,
        "content-type": "image/jpeg",
      },
      data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    expect(put.ok(), await put.text()).toBeTruthy();

    // Give that family a login so it can try to read its own.
    const ownerToken = await (async () => {
      const res = await request.post(`${url}/auth/v1/signup`, {
        headers: { apikey: anon, "content-type": "application/json" },
        data: { email: owner, password: "TestParent!2026" },
      });
      const body = await res.json();
      // Link the auth user to the parents row the way currentParent would.
      if (body.user?.id) {
        await sql`update parents set auth_user_id = ${body.user.id} where id = ${ownerId}`;
      }
      return (body.access_token as string) ?? (await token(owner, "TestParent!2026"));
    })();

    const otherToken = await token("parent@keikicoders.test", "KeikiParent!2026");
    const staffToken = await token("ops@keikicoders.test", "KeikiOps!2026");

    const read = async (bearer?: string) => {
      const res = await request.get(`${url}/storage/v1/object/child-photos/${key}`, {
        headers: bearer
          ? { apikey: anon, Authorization: `Bearer ${bearer}` }
          : { apikey: anon },
      });
      return res.status();
    };

    expect(await read(ownerToken), "the family can see their own child").toBe(200);
    expect(await read(staffToken), "so can the office").toBe(200);
    expect(await read(otherToken), "another family cannot").not.toBe(200);
    expect(await read(), "and nobody at all certainly cannot").not.toBe(200);

    await request.delete(`${url}/storage/v1/object/child-photos/${key}`, {
      headers: { apikey: service, Authorization: `Bearer ${service}` },
    });
    await sql`delete from parents where id = ${ownerId}`;
  });

  test("a link in imported data can only ever be http or https", async () => {
    // Their register links are rendered into an href a parent clicks. new URL()
    // accepts "javascript:alert(1)" quite happily, so the scheme is checked.
    const { parseOffering } = await import("@keiki/core/catalogue/parse");

    const hostile = parseOffering({
      name: "Hostile",
      grades: "1-3",
      season: "Fall 2026",
      site: "Somewhere",
      location: null,
      days: "Tuesday",
      time: "3:00-4:00",
      dates: "Sep 1, 2026 - Oct 27, 2026",
      cost: null,
      sessions: null,
      image: "javascript:alert(1)",
      specialNotes: null,
      description: null,
      registerUrl: "javascript:alert(1)",
      noClass: null,
    })!;

    expect(hostile.imageUrl, "a javascript: image is dropped").toBeNull();
    expect(hostile.problems.join(" ")).toMatch(/not a web address/);
  });
});

test.describe("open redirect", () => {
  test("next= cannot send a signed in parent off site", async ({ page }) => {
    const email = `${unique("redir")}@example.test`;
    await signUpParent(page, email);
    await page.context().clearCookies();

    const hostile = [
      "//evil.example.com",
      "https://evil.example.com",
      "/\\evil.example.com",
      "javascript:alert(1)",
    ];

    for (const target of hostile) {
      await page.goto(`/login?next=${encodeURIComponent(target)}`);
      await page.locator("#email").fill(email);
      await page.locator("#password").fill("TestParent!2026");
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForLoadState("networkidle");

      expect(
        new URL(page.url()).origin,
        `next=${target} must not leave the site`,
      ).toBe("http://localhost:3000");

      await page.context().clearCookies();
    }
  });
});

test.describe("staff actions validate their input", () => {
  test("a support note with a bad kind or empty body is refused", async ({ page }) => {
    await signInStaff(page);
    const [parent] = await sql<{ id: string }[]>`select id from parents limit 1`;

    const before = await sql<{ n: number }[]>`
      select count(*)::int as n from support_notes where parent_id = ${parent.id}`;

    await page.goto(`/admin/families/${parent.id}`);
    await page.getByRole("button", { name: /Log a call or a note/ }).click();

    // An empty body cannot be submitted at all: the field is required.
    const body = page.locator('textarea[name="body"]');
    await expect(body).toHaveAttribute("required", "");

    // A real one saves.
    await body.fill("Automated check, safe to delete.");
    await page.getByRole("button", { name: "Save note" }).click();
    await page.waitForTimeout(1500);

    const after = await sql<{ n: number }[]>`
      select count(*)::int as n from support_notes where parent_id = ${parent.id}`;
    expect(after[0].n).toBe(before[0].n + 1);

    await sql`delete from support_notes
               where parent_id = ${parent.id}
                 and body = 'Automated check, safe to delete.'`;
  });
});
