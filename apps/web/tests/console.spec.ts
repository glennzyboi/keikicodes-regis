import { test, expect } from "@playwright/test";
import { sql, signInStaff, unique } from "./helpers";

/**
 * The console rework, proved rather than asserted.
 *
 * Every test here corresponds to something that was reported as broken or
 * something that was claimed to be fixed. Where a claim is structural — "these
 * two pages are one component, so they cannot disagree" — the test checks the
 * consequence rather than the implementation, because that is the part that
 * would actually hurt if it stopped being true.
 */

// ---------------------------------------------------------------------------
// The two reported bugs
// ---------------------------------------------------------------------------

test.describe("signing out", () => {
  /**
   * The rail used to stay on screen after signing out.
   *
   * `/admin/login` sat under the same layout as every console page, so it was a
   * sibling beneath a shared layout, and Next does not re-render a shared layout
   * on a client side navigation between siblings. The page swapped and the rail,
   * already mounted, stayed there.
   *
   * This has to be a real click rather than a goto: a hard navigation always
   * looked correct, which is exactly why the bug survived.
   */
  test("a real click on Sign out leaves no console furniture behind", async ({ page }) => {
    await signInStaff(page);
    await page.goto("/admin/families");
    await expect(page.locator(".ops-rail")).toBeVisible();

    await page.locator("header.ops-topbar form button").click();
    await page.waitForURL(/\/admin\/login/);

    await expect(page.locator(".ops-rail")).toHaveCount(0);
    await expect(page.locator(".ops-topbar")).toHaveCount(0);
    await expect(page.locator(".ops-login")).toBeVisible();
  });

  test("a signed out visitor is redirected, with a real status code", async ({ request }) => {
    // No cookies on this request context at all.
    const res = await request.get("/admin/classes", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()["location"]).toContain("/admin/login");
  });
});

test.describe("the session going stale", () => {
  /**
   * The reported bug: "the login keeps going stale".
   *
   * `jwt_expiry` is an hour, refresh token rotation is on, and the reuse window
   * is ten seconds. A Server Component that met an expired access token would
   * refresh it, receive a new refresh token, and then fail to write the cookie,
   * because cookies are read only in a Server Component. The old refresh token
   * was now revoked and the new one had been thrown away, so the next request
   * had no session at all.
   *
   * Reproduced by ageing the cookie rather than by waiting an hour: the stored
   * session carries its own `expires_at`, and setting that into the past makes
   * the client treat the access token as expired and refresh it, which is
   * precisely the path that used to destroy the session.
   */
  test("an expired access token is refreshed and the new one is written back", async ({
    page,
    context,
  }) => {
    await signInStaff(page);

    const before = await context.cookies();
    const authCookies = before.filter((c) => /^sb-.*-auth-token/.test(c.name));
    expect(authCookies.length, "a supabase auth cookie should exist after signing in").toBeGreaterThan(0);

    // Age the stored session. The cookie is base64 JSON, possibly split across
    // numbered chunks, so reassemble it, edit it, and put it back the same way.
    const ordered = authCookies.sort((a, b) => a.name.localeCompare(b.name));
    const raw = ordered.map((c) => c.value).join("");
    expect(raw.startsWith("base64-"), `unexpected cookie encoding: ${raw.slice(0, 12)}`).toBe(true);

    const json = JSON.parse(Buffer.from(raw.slice("base64-".length), "base64").toString("utf8"));
    expect(json.refresh_token, "the session should carry a refresh token").toBeTruthy();

    json.expires_at = Math.floor(Date.now() / 1000) - 120;
    json.expires_in = 0;

    const aged = "base64-" + Buffer.from(JSON.stringify(json), "utf8").toString("base64url");
    const chunk = Math.ceil(aged.length / ordered.length);
    await context.clearCookies();
    await context.addCookies(
      ordered.map((c, i) => ({
        ...c,
        value: aged.slice(i * chunk, (i + 1) * chunk),
      })),
    );

    // The request that used to end the session.
    const res = await page.goto("/admin/families");
    expect(res?.status(), "an expired access token must not sign anybody out").toBe(200);
    await expect(page.locator(".ops-rail")).toBeVisible();

    // And the rotation actually reached the browser, which is the half that was
    // missing: without it the next request carries a revoked refresh token.
    const after = await context.cookies();
    const afterRaw = after
      .filter((c) => /^sb-.*-auth-token/.test(c.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => c.value)
      .join("");
    expect(afterRaw, "the refreshed session must be written back to the browser").not.toBe(aged);

    // Still usable on the request after that, which is what "not stale" means.
    const again = await page.goto("/admin/students");
    expect(again?.status()).toBe(200);
    await expect(page.locator(".ops-rail")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

test.describe("filters", () => {
  test("a dropdown applies on touch, with no Apply button, and lands in the URL", async ({
    page,
  }) => {
    await signInStaff(page);
    await page.goto("/admin/classes?term=all&view=table");

    const [school] = await sql<{ id: string; name: string; n: number }[]>`
      select s.id, s.name, count(c.id)::int as n
        from schools s join class_offerings c on c.school_id = s.id
       group by s.id, s.name having count(c.id) between 1 and 9
       order by n desc limit 1`;

    await expect(page.getByRole("button", { name: "Apply" })).toHaveCount(0);

    await page.locator('select[name="school"], .ops-filter-select').nth(1).selectOption(school.id);
    await page.waitForURL(new RegExp(`school=${school.id}`));

    // The rows really are only that campus's.
    const rows = page.locator(".ops-table tbody tr");
    await expect(rows).toHaveCount(school.n);
    await expect(page.locator(".ops-chip", { hasText: school.name })).toBeVisible();
  });

  test("a chip takes its own filter off and leaves the others alone", async ({ page }) => {
    await signInStaff(page);
    const [school] = await sql<{ id: string; name: string }[]>`
      select s.id, s.name from schools s
       where exists (select 1 from class_offerings c where c.school_id = s.id)
       order by s.name limit 1`;

    await page.goto(`/admin/classes?school=${school.id}&status=published`);
    await expect(page.locator(".ops-chip")).toHaveCount(4); // term, campus, status, clear all

    await page.locator(".ops-chip", { hasText: school.name }).click();
    await page.waitForURL((u) => !u.searchParams.has("school"));
    expect(new URL(page.url()).searchParams.get("status")).toBe("published");
  });

  /**
   * The default that is shown rather than hidden.
   *
   * The class list opens on the current term because that is the only one
   * anybody is fielding calls about. A default nobody can see is a lie about
   * what is on screen, so it appears as a chip, and taking the chip off widens
   * to every term rather than putting the default straight back.
   */
  test("the current term is the default, is visible as a chip, and widens when removed", async ({
    page,
  }) => {
    await signInStaff(page);
    await page.goto("/admin/classes?view=table");

    const [{ current }] = await sql<{ current: number }[]>`
      select count(*)::int as current from class_offerings c
        join terms t on t.id = c.term_id where t.is_current`;
    const [{ all }] = await sql<{ all: number }[]>`
      select count(*)::int as all from class_offerings`;

    await expect(page.locator(".ops-chip", { hasText: "Term:" })).toBeVisible();
    await expect(page.locator(".ops-table tbody tr")).toHaveCount(Math.min(current, 10));

    await page.locator(".ops-chip", { hasText: "Term:" }).click();
    await page.waitForURL(/term=all/);

    // Widening really widens: the total on the pager is every class now.
    await expect(page.locator(".ops-pager")).toContainText(String(all));
  });

  test("rubbish in a filter renders the normal page rather than an empty one", async ({
    page,
  }) => {
    await signInStaff(page);

    const [{ all }] = await sql<{ all: number }[]>`select count(*)::int as all from class_offerings`;
    const junk = [
      "status=banana",
      "school=notauuid",
      "weekday=99",
      "fill=%27%20or%201%3D1--",
      "sort=%27%3B%20drop%20table%20class_offerings%3B--&dir=asc",
      "page=-4",
    ];

    for (const q of junk) {
      const res = await page.goto(`/admin/classes?term=all&view=table&${q}`);
      expect(res?.status(), q).toBe(200);
      await expect(page.locator(".ops-table"), q).toBeVisible();
      await expect(page.locator(".ops-pager"), q).toContainText(String(all));
    }

    // And nothing was executed.
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from class_offerings`;
    expect(n).toBe(all);
  });
});

// ---------------------------------------------------------------------------
// Skeletons that actually fire
// ---------------------------------------------------------------------------

test.describe("skeletons", () => {
  /**
   * Ten `loading.tsx` files existed and none of them appeared when anybody
   * changed a filter: `loading.tsx` covers arriving at a route, not changing the
   * query string on one you are already on. The fix is a Suspense boundary keyed
   * on the filter state, and this is the test that says so.
   */
  test("changing a filter shows a skeleton, not a frozen table", async ({ page }) => {
    await signInStaff(page);
    await page.goto("/admin/classes?term=all&view=table");

    // Hold the server response long enough to observe the pending UI.
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route(/\/admin\/classes\?.*school=/, async (route) => {
      await held;
      await route.continue();
    });

    const [school] = await sql<{ id: string }[]>`
      select s.id from schools s
       where exists (select 1 from class_offerings c where c.school_id = s.id) limit 1`;

    await page.locator(".ops-filter-select").nth(1).selectOption(school.id);

    // The bar says it is working while the rows are being read.
    await expect(page.locator(".ops-filters[data-pending]")).toBeVisible({ timeout: 5000 });

    release();
    await page.waitForURL(new RegExp(`school=${school.id}`));
    await expect(page.locator(".ops-filters[data-pending]")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// One list, several entrances
// ---------------------------------------------------------------------------

test.describe("no repetition", () => {
  /**
   * The structural claim of the whole rework: a campus page and a program page
   * are the Classes list with a filter pre-applied, not copies of it.
   *
   * Checked by consequence. If these ever return different sets, the pages have
   * been forked, which is the exact failure the old Catalogue and Rosters pair
   * had already suffered.
   */
  test("a program page lists exactly what the class list lists for that program", async ({
    page,
  }) => {
    await signInStaff(page);

    const [program] = await sql<{ id: string; n: number }[]>`
      select p.id, count(c.id)::int as n
        from programs p join class_offerings c on c.program_id = p.id
       group by p.id order by n desc limit 1`;

    const idsOn = async (url: string) => {
      await page.goto(url);
      const hrefs = await page.locator('a[href^="/admin/classes/"]').evaluateAll((as) =>
        as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!),
      );
      // Only real records. "/admin/classes/new" is a button on this page and
      // was quietly arriving in the set as the id "new".
      return [...new Set(hrefs.map((h) => h.split("/")[3]))]
        .filter((id) => /^[0-9a-f-]{36}$/.test(id))
        .sort();
    };

    const viaSetup = await idsOn(`/admin/setup/programs/${program.id}?term=all&view=table`);
    const viaClasses = await idsOn(`/admin/classes?program=${program.id}&term=all&view=table`);

    expect(viaSetup.length).toBeGreaterThan(1);
    expect(viaSetup).toEqual(viaClasses);
  });

  test("a campus page lists exactly what the class list lists for that campus", async ({
    page,
  }) => {
    await signInStaff(page);

    const [school] = await sql<{ id: string; n: number }[]>`
      select s.id, count(c.id)::int as n
        from schools s join class_offerings c on c.school_id = s.id
       group by s.id having count(c.id) <= 10 order by n desc limit 1`;

    const idsOn = async (url: string) => {
      await page.goto(url);
      const hrefs = await page.locator('a[href^="/admin/classes/"]').evaluateAll((as) =>
        as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!),
      );
      // Only real records. "/admin/classes/new" is a button on this page and
      // was quietly arriving in the set as the id "new".
      return [...new Set(hrefs.map((h) => h.split("/")[3]))]
        .filter((id) => /^[0-9a-f-]{36}$/.test(id))
        .sort();
    };

    expect(await idsOn(`/admin/setup/campuses/${school.id}?term=all&view=table`)).toEqual(
      await idsOn(`/admin/classes?school=${school.id}&term=all&view=table`),
    );
  });
});

// ---------------------------------------------------------------------------
// Paging, sorting, and getting into a record
// ---------------------------------------------------------------------------

test.describe("lists", () => {
  test("ten rows a page, and page two holds different rows", async ({ page }) => {
    await signInStaff(page);

    // Compare the ids the rows link to, not a column. The first attempt read
    // column two, which is the Campus, and a campus legitimately appears on
    // both pages: the test failed while the paging was perfectly correct.
    const idsOnPage = async (url: string) => {
      await page.goto(url);
      const hrefs = await page.locator(".ops-table tbody a.ops-row-link").evaluateAll((as) =>
        as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!),
      );
      return hrefs.map((h) => h.split("/")[3]);
    };

    const p1 = await idsOnPage("/admin/classes?term=all&view=table&sort=title&dir=asc");
    const p2 = await idsOnPage("/admin/classes?term=all&view=table&sort=title&dir=asc&page=2");

    expect(p1.length).toBe(10);
    expect(p2.length).toBeGreaterThan(0);
    expect(p1.some((t) => p2.includes(t))).toBe(false);
  });

  test("a sort link reverses the list", async ({ page }) => {
    await signInStaff(page);

    await page.goto("/admin/classes?term=all&view=table&sort=title&dir=asc");
    const first = await page.locator(".ops-table tbody tr").first().innerText();

    await page.goto("/admin/classes?term=all&view=table&sort=title&dir=desc");
    const last = await page.locator(".ops-table tbody tr").first().innerText();

    expect(first).not.toBe(last);
  });

  test("a whole card is one link into the class", async ({ page }) => {
    await signInStaff(page);
    await page.goto("/admin/classes?term=all");

    const card = page.locator(".ops-card").first();
    const title = await card.locator(".ops-card-title").innerText();
    await card.locator(".ops-card-link").click();

    await page.waitForURL(/\/admin\/classes\/[0-9a-f-]{36}$/);
    await expect(page.locator("h1")).toHaveText(title);
  });

  /**
   * The two buttons somebody found confusing while testing.
   *
   * They acted only on whichever date happened to be next, and looked like the
   * way to change a schedule. The real editor is a tab on the class and can act
   * on any date, several dates, or the whole term.
   */
  test("the class cards no longer carry Cancel it and Move it", async ({ page }) => {
    await signInStaff(page);
    await page.goto("/admin/classes?term=all");

    await expect(page.getByRole("button", { name: "Cancel it" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Move it" })).toHaveCount(0);
  });

  test("every class tab loads and keeps the header", async ({ page }) => {
    await signInStaff(page);
    const [cls] = await sql<{ id: string; title: string }[]>`
      select id, title from class_offerings where status = 'published' limit 1`;

    for (const tab of ["", "/roster", "/schedule", "/money", "/edit"]) {
      const res = await page.goto(`/admin/classes/${cls.id}${tab}`);
      expect(res?.status(), tab || "overview").toBe(200);
      await expect(page.locator("h1"), tab || "overview").toHaveText(cls.title);
      await expect(page.locator(".ops-tabs"), tab || "overview").toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// Addresses that moved
// ---------------------------------------------------------------------------

test.describe("the catalogue's old addresses", () => {
  test("every one of them is a real permanent redirect", async ({ request }) => {
    const moves: [string, string][] = [
      ["/admin/catalogue", "/admin/setup/programs"],
      ["/admin/catalogue/classes", "/admin/classes"],
      ["/admin/catalogue/schools", "/admin/setup/campuses"],
      ["/admin/catalogue/programs", "/admin/setup/programs"],
      ["/admin/catalogue/terms", "/admin/setup/terms"],
      ["/admin/setup", "/admin/setup/programs"],
    ];

    for (const [from, to] of moves) {
      const res = await request.get(from, { maxRedirects: 0 });
      expect(res.status(), from).toBe(308);
      expect(res.headers()["location"], from).toContain(to);
    }
  });

  test("an old class edit link still opens that class's editor", async ({ request }) => {
    const [cls] = await sql<{ id: string }[]>`select id from class_offerings limit 1`;
    const res = await request.get(`/admin/catalogue/classes/${cls.id}`, { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(res.headers()["location"]).toContain(`/admin/classes/${cls.id}/edit`);
  });
});

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

test.describe("catalogue pictures", () => {
  test("staff can replace a program's picture, and it changes every class using it", async ({
    page,
  }) => {
    await signInStaff(page);

    const [program] = await sql<{ id: string; n: number }[]>`
      select p.id, count(c.id)::int as n
        from programs p join class_offerings c on c.program_id = p.id
       group by p.id order by n desc limit 1`;
    expect(program.n).toBeGreaterThan(1);

    await page.goto(`/admin/setup/programs/${program.id}`);

    // Picking a file submits from a change handler, so the control is inert
    // until React has hydrated. It now says so, and this waits for it rather
    // than racing it: without this the spec passed alone, where a cold compile
    // made the page slow enough, and failed inside a suite where it was warm.
    await expect(page.locator(".ops-imagefield[data-ready]").first()).toBeVisible();

    // A tiny but genuinely valid PNG.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.locator('.ops-imagefield input[type="file"]').setInputFiles({
      name: `${unique("pic")}.png`,
      mimeType: "image/png",
      buffer: png,
    });

    await expect(page.locator(".ops-note-good")).toContainText("everywhere this program runs");

    const [{ image_url }] = await sql<{ image_url: string }[]>`
      select image_url from programs where id = ${program.id}`;
    expect(image_url).toContain("/storage/v1/object/public/program-images/");

    // It really is fetchable, rather than a URL we merely wrote down.
    const fetched = await page.request.get(image_url);
    expect(fetched.status()).toBe(200);
  });

  test("a parent's session cannot write to the catalogue buckets", async ({ request }) => {
    // The storage policy is the control, so prove it refuses a non-staff token
    // rather than trusting that no UI offers the button.
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const email = `${unique("nostaff")}@example.test`;
    const signUp = await request.post(`${base}/auth/v1/signup`, {
      headers: { apikey: anon, "content-type": "application/json" },
      data: { email, password: "TestParent!2026" },
    });
    expect(signUp.ok()).toBe(true);
    const token = (await signUp.json()).access_token as string;
    expect(token, "the test needs a real non-staff token").toBeTruthy();

    const res = await request.post(
      `${base}/storage/v1/object/program-images/${unique("hack")}.png`,
      {
        headers: {
          apikey: anon,
          authorization: `Bearer ${token}`,
          "content-type": "image/png",
        },
        data: Buffer.from("not really a png"),
      },
    );

    expect(res.status(), "a parent must not be able to write catalogue images").toBeGreaterThanOrEqual(400);
  });
});

// ---------------------------------------------------------------------------
// Numbers that have to agree with each other
// ---------------------------------------------------------------------------

test.describe("totals", () => {
  /**
   * `countOf('unconfirmed')` used to ask a different question from the list it
   * was counting and a third one again from the rail badge. It was invisible
   * while nothing paged that list; the moment it did, the total above the rows
   * would have disagreed with the rows.
   */
  test("the money page's headline numbers match the database", async ({ page }) => {
    await signInStaff(page);
    await page.goto("/admin/money");

    const [row] = await sql<{ unconfirmed: number; cancellations: number }[]>`
      select (select count(*)::int from orders
               where status = 'paid' and fulfilled_at is null) as unconfirmed,
             (select count(*)::int from enrollments
               where status = 'cancellation_requested') as cancellations`;

    const stat = (label: string) =>
      page.locator(".ops-stat", { hasText: label }).locator(".ops-stat-value");

    await expect(stat("Unconfirmed")).toHaveText(String(row.unconfirmed));
    await expect(stat("Waiting on a decision")).toHaveText(String(row.cancellations));
  });

  test("a filtered pager total counts the filtered rows, not everything", async ({ page }) => {
    await signInStaff(page);

    const [school] = await sql<{ id: string; n: number }[]>`
      select s.id, count(c.id)::int as n
        from schools s join class_offerings c on c.school_id = s.id
       group by s.id having count(c.id) between 1 and 9 order by n desc limit 1`;

    await page.goto(`/admin/classes?term=all&view=table&school=${school.id}`);
    await expect(page.locator(".ops-pager")).toContainText(`of ${school.n}`);
  });
});
