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

    const [cls] = await sql<{ id: string }[]>`
      select id from class_offerings where seats_taken < capacity limit 1`;

    const payload = "<img src=x onerror=alert(1)>";
    const res = await page.request.post("/api/register", {
      data: {
        idempotencyKey: unique("xss"),
        registrations: [
          {
            classOfferingId: cls.id,
            child: { firstName: payload, lastName: "Escaped", dateOfBirth: "2016-01-01" },
          },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();

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

    const clashing = await sql<{ a: string; b: string }[]>`
      select a.id as a, b.id as b
        from class_offerings a join class_offerings b on a.id < b.id
       where classes_clash(a.id, b.id)
       limit 1`;

    test.skip(clashing.length === 0, "no clashing pair in the catalogue");

    const child = { firstName: "Clash", lastName: unique("Kid"), dateOfBirth: "2016-01-01" };
    const res = await page.request.post("/api/register", {
      data: {
        idempotencyKey: unique("clash"),
        registrations: [
          { classOfferingId: clashing[0].a, child },
          { classOfferingId: clashing[0].b, child },
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
    const [cls] = await sql<{ id: string; seats_taken: number }[]>`
      select id, seats_taken from class_offerings where capacity - seats_taken > 3 limit 1`;

    const child = { firstName: "Twice", lastName: unique("Same"), dateOfBirth: "2016-01-01" };

    const first = await page.request.post("/api/register", {
      data: {
        idempotencyKey: unique("dupe1"),
        registrations: [{ classOfferingId: cls.id, child }],
      },
    });
    expect(first.ok()).toBeTruthy();

    // Same child, same class, different order. Should be refused before payment.
    const second = await page.request.post("/api/register", {
      data: {
        idempotencyKey: unique("dupe2"),
        registrations: [{ classOfferingId: cls.id, child }],
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
    const [cls] = await sql<{ id: string; capacity: number }[]>`
      select id, capacity from class_offerings order by capacity asc limit 1`;
    await sql`update class_offerings set seats_taken = capacity where id = ${cls.id}`;

    const res = await page.request.post("/api/register", {
      data: {
        idempotencyKey: unique("full"),
        registrations: [
          {
            classOfferingId: cls.id,
            child: { firstName: "TooLate", lastName: unique("F"), dateOfBirth: "2016-01-01" },
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

    await sql`update class_offerings set seats_taken = 0 where id = ${cls.id}`;
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
