import { test, expect } from "@playwright/test";
import { sql, unique, signUpParent, signInStaff, STAFF } from "./helpers";

/**
 * Auth boundaries, written to break them.
 *
 * Every one of these is an attack someone would actually try: walking to a URL
 * they were not given, posting to an endpoint without a session, and signing in
 * on the wrong door. The point is not that the happy path works, it is that the
 * unhappy paths are refused.
 */

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("every private page redirects to the right sign in", async ({ page }) => {
    const cases: [string, RegExp][] = [
      ["/dashboard", /\/login/],
      ["/admin", /\/admin\/login/],
      ["/admin/money", /\/admin\/login/],
      ["/admin/families", /\/admin\/login/],
      ["/admin/students", /\/admin\/login/],
      ["/admin/classes", /\/admin\/login/],
      ["/admin/schedule", /\/admin\/login/],
      ["/admin/holds", /\/admin\/login/],
      ["/admin/notifications", /\/admin\/login/],
      ["/admin/setup/campuses", /\/admin\/login/],
      ["/admin/setup/programs", /\/admin\/login/],
      ["/admin/setup/terms", /\/admin\/login/],
      // The tabs on a class are routes of their own now, so each one is its own
      // chance to have been added without a gate. The (console) layout is the
      // single gate, which is the point, but a list that only names the parent
      // route would not notice if that stopped being true.
      ["/admin/classes/new", /\/admin\/login/],
      // The old address for the dashboard, which every confirmation email ever
      // sent still points at. It has to keep working, and it has to end up
      // behind the same sign in.
      ["/portal", /\/login/],
    ];

    for (const [path, expected] of cases) {
      await page.goto(path);
      await expect(page, `${path} should bounce to sign in`).toHaveURL(expected);
    }
  });

  test("the register page bounces and remembers where you were going", async ({ page }) => {
    const [cls] = await sql<{ id: string }[]>`
      select id from class_offerings limit 1`;
    await page.goto(`/register/${cls.id}`);
    await expect(page).toHaveURL(new RegExp(`/login\\?next=.*${cls.id}`));
  });

  test("public pages stay public", async ({ page }) => {
    for (const path of ["/", "/login", "/signup", "/programs", "/register"]) {
      const res = await page.goto(path);
      expect(res?.status(), `${path} should be reachable`).toBe(200);
    }

    // A class detail page is public too: it is the thing parents send each
    // other, so putting it behind an account would defeat the point of it
    // having an address at all.
    const [cls] = await sql<{ id: string }[]>`
      select id from class_offerings where status = 'published' limit 1`;
    const res = await page.goto(`/programs/${cls.id}`);
    expect(res?.status(), "a class page is shareable").toBe(200);
  });

  test("the old dashboard address is a permanent redirect, not a 404", async ({ request }) => {
    // 308 rather than 302 or a React page that redirects: this URL is in every
    // confirmation email we have ever sent, and a mail client and a search
    // engine should both be told it moved for good.
    const res = await request.get("/portal", { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(res.headers()["location"]).toContain("/dashboard");
  });

  test("every write endpoint refuses an anonymous caller", async ({ request }) => {
    const [cls] = await sql<{ id: string }[]>`select id from class_offerings limit 1`;
    const [enrollment] = await sql<{ id: string }[]>`select id from enrollments limit 1`;
    const [order] = await sql<{ id: string }[]>`select id from orders limit 1`;

    const register = await request.post("/api/register", {
      data: {
        idempotencyKey: unique("anon"),
        registrations: [
          {
            classOfferingId: cls.id,
            child: { firstName: "Anon", lastName: "Nobody", dateOfBirth: "2016-01-01" },
          },
        ],
      },
    });
    expect(register.status(), "register must refuse anonymous").toBe(401);

    if (enrollment) {
      // No reason code, on purpose: identity is checked before the body, so
      // somebody who is not signed in never learns the shape of this endpoint.
      const cancel = await request.post("/api/portal/cancel", {
        data: { enrollmentId: enrollment.id },
      });
      expect(cancel.status(), "cancel must refuse anonymous before validating").toBe(401);
    }

    if (order) {
      const status = await request.get(`/api/orders/${order.id}`);
      expect(status.status(), "order status must refuse anonymous").toBe(401);
    }
  });
});

test.describe("a parent is not staff", () => {
  test("a signed in parent cannot reach any admin page", async ({ page }) => {
    await signUpParent(page, `${unique("notstaff")}@example.test`, "Not Staff");

    for (const path of [
      "/admin",
      "/admin/money",
      "/admin/families",
      "/admin/students",
      "/admin/classes",
      "/admin/schedule",
      "/admin/holds",
      "/admin/notifications",
    ]) {
      await page.goto(path);
      await expect(page, `${path} must not open for a parent`).toHaveURL(/\/admin\/login/);
    }
  });

  test("a parent cannot open another family's data by walking the id", async ({ page }) => {
    // Two real accounts, each with their own registration.
    const victimEmail = `${unique("victim")}@example.test`;
    await signUpParent(page, victimEmail, "Victim Family");
    const [victim] = await sql<{ id: string }[]>`
      select id from parents where email = ${victimEmail}`;

    // Anything at all belonging to somebody else.
    const [otherEnrollment] = await sql<{ id: string }[]>`
      select e.id from enrollments e
        join children ch on ch.id = e.child_id
       where ch.parent_id <> ${victim.id}
       limit 1`;
    const [otherOrder] = await sql<{ id: string }[]>`
      select id from orders where parent_id <> ${victim.id} limit 1`;

    if (otherOrder) {
      const res = await page.request.get(`/api/orders/${otherOrder.id}`);
      expect(res.status(), "another family's order must be 404").toBe(404);
    }

    if (otherEnrollment) {
      const res = await page.request.post("/api/portal/cancel", {
        // A valid body, deliberately. Being refused for a malformed request
        // proves nothing about who owns the enrollment.
        data: { enrollmentId: otherEnrollment.id, reasonCode: "cost" },
      });
      expect(res.status(), "another family's enrollment must not cancel").toBe(404);

      // And it really did not change.
      const [after] = await sql<{ status: string }[]>`
        select status from enrollments where id = ${otherEnrollment.id}`;
      expect(after.status).not.toBe("cancellation_requested");
    }
  });

  test("parent credentials are refused at the staff door", async ({ page }) => {
    const email = `${unique("wrongdoor")}@example.test`;
    await signUpParent(page, email, "Wrong Door");
    await page.context().clearCookies();

    await page.goto("/admin/login");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill("TestParent!2026");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.locator("form p[role=alert]")).toContainText(/not a staff account/i);
    await expect(page).toHaveURL(/\/admin\/login/);

    // And the session was torn down rather than left half open.
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});

test.describe("staff", () => {
  test("staff can reach every console page", async ({ page }) => {
    await signInStaff(page);

    const pages: [string, RegExp][] = [
      ["/admin", /(waiting on you|Nothing needs a decision)/],
      ["/admin/money", /Money/],
      ["/admin/families", /Families/],
      ["/admin/students", /Students/],
      ["/admin/classes", /Classes/],
      ["/admin/schedule", /Schedule/],
      ["/admin/holds", /Seat holds/],
      ["/admin/notifications", /Outbox/],
    ];

    for (const [path, heading] of pages) {
      await page.goto(path);
      await expect(page, `${path} should stay open for staff`).toHaveURL(
        new RegExp(path.replace("/", "\\/")),
      );
      await expect(
        page.getByRole("heading", { name: heading }).first(),
        `${path} should render its heading`,
      ).toBeVisible();
    }
  });

  test("wrong staff password is refused, and says nothing useful", async ({ page }) => {
    await page.goto("/admin/login");
    await page.locator("#email").fill(STAFF.email);
    await page.locator("#password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    const alert = page.locator("form p[role=alert]");
    await expect(alert).toBeVisible();
    // The same message a nonexistent address gets, so this cannot be used to
    // find out who works here.
    await expect(alert).toContainText(/do not match/i);
  });

  test("an address that does not exist gets the identical message", async ({ page }) => {
    await page.goto("/admin/login");
    await page.locator("#email").fill("nobody-at-all@keikicoders.com");
    await page.locator("#password").fill("whatever");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("form p[role=alert]")).toContainText(/do not match/i);
  });

  test("staff are not a family, and the portal does not crash for them", async ({ page }) => {
    await signInStaff(page);

    // One Supabase session covers both sides of the app, so a staff member can
    // walk to the parent portal. This used to turn them into a parent, putting
    // the office address in the families list, and then 500 on the next render
    // when the insert hit the auth_user_id unique constraint.
    const res = await page.goto("/dashboard");
    expect(res?.status(), "the portal must not error for staff").toBeLessThan(500);
    await expect(page).toHaveURL(/\/login/);

    const polluted = await sql<{ email: string }[]>`
      select p.email from parents p
        join staff s on s.auth_user_id = p.auth_user_id`;
    expect(polluted, "a staff account must never become a family").toHaveLength(0);
  });

  test("signing out actually ends the session", async ({ page }) => {
    await signInStaff(page);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/admin\/login/, { timeout: 20_000 });

    await page.goto("/admin/money");
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
