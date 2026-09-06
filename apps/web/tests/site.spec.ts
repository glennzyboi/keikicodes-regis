import { test, expect } from "@playwright/test";
import {
  sql,
  signInStaff,
  signUpParent,
  unique,
  freeClass,
  fillDate,
  fillRegistration,
} from "./helpers";
import { HOLD_MINUTES } from "@keiki/core/holds";
import { PER_PAGE } from "../src/app/admin/ui";

/**
 * The parent facing site, and the console's list pages.
 *
 * Everything here is new in this pass: the navigation split, the school
 * combobox, the fixed size cards, the class detail pages, and paging on the
 * console lists that used to truncate silently at a hundred rows.
 */

test.describe("navigation", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("browsing and registering are separate destinations", async ({ page }) => {
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Programs" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Register" })).toBeVisible();

    // Signed out, there is no dashboard to offer.
    await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveCount(0);

    // The current page is marked for a screen reader too, not only in colour.
    await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await nav.getByRole("link", { name: "Programs" }).click();
    await expect(page).toHaveURL(/\/programs$/);
    await expect(nav.getByRole("link", { name: "Programs" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await nav.getByRole("link", { name: "Register" }).click();
    await expect(page).toHaveURL(/\/register$/);
  });

  test("a signed in parent gets a dashboard tab", async ({ page }) => {
    const email = `${unique("nav")}@example.test`;
    await signUpParent(page, email, "Nav Family");
    await page.goto("/");
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Dashboard" }),
    ).toBeVisible();
  });
});

test.describe("the school picker", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("is a real combobox: type, arrow, enter", async ({ page }) => {
    await page.goto("/programs");
    const input = page.locator("input[role=combobox]");

    await expect(input).toHaveAttribute("aria-expanded", "false");
    await input.click();
    await expect(input).toHaveAttribute("aria-expanded", "true");

    const [school] = await sql<{ name: string; slug: string }[]>`
      select s.name, s.slug from schools s
        join class_offerings c on c.school_id = s.id and c.status = 'published'
       group by s.id, s.name, s.slug order by s.name limit 1`;

    await input.fill(school.name.slice(0, 4));
    await expect(page.locator(".kc-combo-option").first()).toBeVisible();

    // Arrowing sets the active option, which is what a screen reader reads.
    await input.press("ArrowDown");
    await expect(input).toHaveAttribute("aria-activedescendant", /.+/);

    await input.press("Enter");
    await expect(page).toHaveURL(/\/schools\//);
  });

  test("finds a school typed without its ʻokina", async ({ page }) => {
    // Somebody on a phone keyboard types "hanahauoli", and a search that only
    // matches the pretty spelling fails exactly the families it is for.
    const [school] = await sql<{ name: string; slug: string }[]>`
      select name, slug from schools where name like '%‘%' limit 1`;
    test.skip(!school, "no school in the catalogue has an ʻokina in its name");

    const plain = school.name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[ʻ‘’']/g, "")
      .split(" ")[0]
      .toLowerCase();

    await page.goto("/programs");
    await page.locator("input[role=combobox]").fill(plain);
    await expect(page.locator(".kc-combo-option").first()).toContainText(
      school.name.split(" ")[0],
    );
  });

  test("says so when nothing matches, rather than showing an empty box", async ({ page }) => {
    await page.goto("/programs");
    await page.locator("input[role=combobox]").fill("zzzznotaschool");
    await expect(page.locator(".kc-combo-empty")).toContainText("No school matches");
  });

  test("the register flow only offers campuses we actually sell", async ({ page }) => {
    await page.goto("/register");
    await page.locator("input[role=combobox]").click();

    const shown = await page.locator(".kc-combo-option").count();
    const [{ sellable }] = await sql<{ sellable: number }[]>`
      select count(*)::int as sellable from (
        select s.id from schools s
          join class_offerings c on c.school_id = s.id and c.status = 'published'
         group by s.id
        having bool_or(c.registration_mode = 'keiki_coders')) x`;

    // Sending a family down a registration flow that ends in "this school takes
    // its own registrations" is a dead end they walked into on our invitation.
    expect(shown).toBe(sellable);
  });
});

test.describe("class cards and their pages", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("cards are the same height and the register button is on them", async ({ page }) => {
    const [school] = await sql<{ slug: string }[]>`
      select s.slug from schools s
        join class_offerings c on c.school_id = s.id
       where c.status = 'published' and c.registration_mode = 'keiki_coders'
       group by s.slug having count(*) >= 3 limit 1`;
    test.skip(!school, "no campus has three sellable classes");

    await page.goto(`/schools/${school.slug}`);

    const cards = page.locator(".kc-tile");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Every card in the first row is the same height. The old expanding card
    // made the grid ragged before anybody touched it.
    const boxes = await cards.evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().height)),
    );
    const firstRowTop = await cards.first().evaluate((el) => el.getBoundingClientRect().top);
    const sameRow = await cards.evaluateAll(
      (els, top) =>
        els
          .map((el) => ({
            top: Math.round(el.getBoundingClientRect().top),
            h: Math.round(el.getBoundingClientRect().height),
          }))
          .filter((b) => Math.abs(b.top - Math.round(top)) < 4)
          .map((b) => b.h),
      firstRowTop,
    );
    expect(new Set(sameRow).size, `heights in the first row: ${sameRow}`).toBe(1);
    expect(boxes.length).toBe(count);

    // Register is visible without opening anything.
    await expect(cards.first().getByRole("link", { name: "Register", exact: true })).toBeVisible();
  });

  test("a class has its own page, which is what a parent can send somebody", async ({ page }) => {
    const [cls] = await sql<{ id: string; title: string; school: string }[]>`
      select c.id, c.title, s.name as school
        from class_offerings c join schools s on s.id = c.school_id
       where c.status = 'published' and c.registration_mode = 'keiki_coders'
       limit 1`;

    await page.goto(`/programs/${cls.id}`);
    await expect(page.getByRole("heading", { name: cls.title })).toBeVisible();

    // The title is the thing a link preview reads, so it names the class and
    // the campus rather than saying "Keiki Coders".
    await expect(page).toHaveTitle(new RegExp(cls.title.split(":")[0]));
    await expect(page).toHaveTitle(new RegExp(cls.school.split(" ")[0]));

    // Every date, with the holidays struck through and explained rather than
    // left as gaps a parent has to work out.
    const [counts] = await sql<{ scheduled: number; off: number }[]>`
      select count(*) filter (where status = 'scheduled')::int as scheduled,
             count(*) filter (where status <> 'scheduled')::int as off
        from sessions where class_offering_id = ${cls.id}`;
    await expect(page.locator("ol li")).toHaveCount(counts.scheduled + counts.off);

    await expect(page.getByRole("link", { name: /Register for this class/ })).toBeVisible();
  });

  test("a class the school enrols itself cannot be bought here", async ({ page }) => {
    const [cls] = await sql<{ id: string; school: string }[]>`
      select c.id, s.name as school
        from class_offerings c join schools s on s.id = c.school_id
       where c.status = 'published' and c.registration_mode = 'external'
       limit 1`;
    test.skip(!cls, "no externally registered class in the catalogue");

    await page.goto(`/programs/${cls.id}`);
    await expect(page.getByRole("link", { name: /Register for this class/ })).toHaveCount(0);
    await expect(page.getByText(/runs enrollment for this class themselves/)).toBeVisible();
  });

  test("a malformed class id is a real 404, before anything renders", async ({ page }) => {
    // These pages stream, and once a response starts streaming its status has
    // already been sent, so a notFound() inside the page arrives as a 200
    // carrying the not-found UI. That is documented Next behaviour and it is
    // the right trade for a record that genuinely used to exist.
    //
    // It is the wrong answer for a URL that could never have been valid, which
    // is a typo or somebody poking at routes, so src/proxy.ts checks the shape
    // before the render starts and answers a real 404.
    for (const bad of ["not-a-uuid", "../../etc/passwd", "%E0%A4%A"]) {
      const res = await page.goto(`/programs/${encodeURIComponent(bad)}`);
      expect(res?.status(), `${bad} should be a real 404`).toBe(404);
    }

    const slug = await page.goto("/schools/NOT_A_SLUG");
    expect(slug?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /not here/i })).toBeVisible();
  });

  test("a class that has gone is a real 404 too, not a soft one", async ({ page }) => {
    // A well formed id that no longer exists reaches the page, which calls
    // notFound(). That is a real 404 only while the response has not started
    // streaming, which is why there is deliberately no loading.tsx on this
    // route: the skeleton would be worth less than the status code.
    //
    // This assertion was written the other way round first, expecting the soft
    // 200 the framework documents, and the suite caught that the scoping fix
    // had already made it a proper 404.
    const res = await page.goto("/programs/00000000-0000-4000-8000-000000000000");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /not here/i })).toBeVisible();

    // Same for a campus slug that is well formed but not ours.
    const school = await page.goto("/schools/no-such-school-here");
    expect(school?.status()).toBe(404);
  });
});

test.describe("the console pages", () => {
  test.beforeEach(async ({ page }) => {
    await signInStaff(page);
  });

  test("lists page instead of truncating, and the page is a URL", async ({ page }) => {
    // Makes its own data rather than hoping the seed has enough. A test that
    // skips on a fresh database is a test that never runs, which is worse than
    // no test at all because the row in the report looks like coverage.
    const tag = unique("pager");
    const [parent] = await sql<{ id: string }[]>`
      insert into parents (email, full_name)
      values (${`${tag}@example.test`}, ${`Pager ${tag}`})
      returning id`;

    try {
      for (let i = 0; i < 30; i++) {
        await sql`insert into children (parent_id, first_name, last_name, date_of_birth, grade)
                  values (${parent.id}, ${`Pager${String(i).padStart(2, "0")}`}, ${tag},
                          '2016-01-01', 3)`;
      }

      await page.goto(`/admin/students?q=${tag}`);

      await expect(page.locator(".ops-pager")).toContainText("of 30");
      await expect(page.locator(".ops-table tbody tr")).toHaveCount(PER_PAGE);

      // The page is a URL, so a colleague can be sent "page 2 of that search".
      await page.getByRole("link", { name: "Page 2" }).click();
      await expect(page).toHaveURL(/page=2/);
      await expect(page).toHaveURL(new RegExp(`q=${tag}`));
      await expect(page.locator(".ops-pager")).toContainText("11 to 20 of 30");
      await expect(page.locator(".ops-table tbody tr")).toHaveCount(PER_PAGE);

      // Ten, not twenty five: a list should fit a laptop screen.
      expect(PER_PAGE).toBe(10);

      // And the rows on page two are different rows, not the same ones again.
      const second = await page.locator(".ops-table tbody tr").first().innerText();
      await page.goto(`/admin/students?q=${tag}`);
      const first = await page.locator(".ops-table tbody tr").first().innerText();
      expect(first).not.toBe(second);
    } finally {
      await sql`delete from children where last_name = ${tag}`;
      await sql`delete from parents where id = ${parent.id}`;
    }
  });

  test("a nonsense page number cannot break the query", async ({ page }) => {
    for (const bad of ["-4", "0", "abc", "999999999999999999999"]) {
      const res = await page.goto(`/admin/families?page=${bad}`);
      expect(res?.status(), `page=${bad}`).toBeLessThan(500);
    }
  });

  test("the count is the real total, not the size of the page", async ({ page }) => {
    // "1 to 25 of 24" is the kind of thing people report as a bug forever
    // afterwards, so the count and the rows are read in one transaction.
    await page.goto("/admin/families");
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from parents`;
    await expect(page.locator(".ops-pager")).toContainText(`of ${n}`);
  });
});

test.describe("the dashboard", () => {
  test("is called a dashboard and shows a calendar first", async ({ page }) => {
    const email = `${unique("dash")}@example.test`;
    await signUpParent(page, email, "Dash Family");
    await page.goto("/dashboard");

    await expect(page.getByText("Dashboard").first()).toBeVisible();

    // "Details" was never what that view is. It is the classes themselves.
    await expect(page.getByRole("button", { name: "Details" })).toHaveCount(0);
  });

  test("one family cannot cancel another family's place", async ({ page, context }) => {
    // The endpoint proves ownership in the WHERE clause rather than trusting
    // the body, so this is the same answer whether the id exists or not.
    const emailA = `${unique("owner")}@example.test`;
    await signUpParent(page, emailA, "Owner Family");

    // A real place belonging to the first family, made directly rather than
    // through Stripe: the thing under test is the ownership check, and the
    // payment path is proven at length elsewhere.
    const [owner] = await sql<{ id: string }[]>`
      select id from parents where email = ${emailA}`;
    const [cls] = await sql<{ id: string; price_cents: number }[]>`
      select id, price_cents from class_offerings
       where status = 'published' and registration_mode = 'keiki_coders'
         and price_cents is not null limit 1`;

    const [child] = await sql<{ id: string }[]>`
      insert into children (parent_id, first_name, last_name, date_of_birth, grade)
      values (${owner.id}, 'Owned', ${unique("kid").replace(/-/g, "")}, '2015-01-01', 3)
      returning id`;
    const [order] = await sql<{ id: string }[]>`
      insert into orders (parent_id, idempotency_key, status, amount_cents, fulfilled_at)
      values (${owner.id}, ${unique("own")}, 'paid', ${cls.price_cents}, now())
      returning id`;
    const [item] = await sql<{ id: string }[]>`
      insert into order_items (order_id, class_offering_id, child_id, unit_price_cents)
      values (${order.id}, ${cls.id}, ${child.id}, ${cls.price_cents})
      returning id`;
    const [any] = await sql<{ id: string }[]>`
      insert into enrollments (class_offering_id, child_id, order_item_id, status)
      values (${cls.id}, ${child.id}, ${item.id}, 'active')
      returning id`;

    await context.clearCookies();
    const emailB = `${unique("thief")}@example.test`;
    await signUpParent(page, emailB, "Thief Family");

    const res = await page.request.post("/api/portal/cancel", {
      data: { enrollmentId: any.id, reasonCode: "cost" },
    });
    expect(res.status()).toBe(404);

    const [still] = await sql<{ status: string }[]>`
      select status from enrollments where id = ${any.id}`;
    expect(still.status, "the other family's place is untouched").toBe("active");

    await sql`delete from enrollments where id = ${any.id}`;
    await sql`delete from order_items where id = ${item.id}`;
    await sql`delete from orders where id = ${order.id}`;
    await sql`delete from children where id = ${child.id}`;
  });
});

test.describe("the photo upload", () => {
  /**
   * The path that had never once been exercised.
   *
   * Every storage assertion in this suite used the service role key, which
   * bypasses row level security entirely, so the thing a parent actually does
   * had no coverage at all. It shipped with `capture="user"` on the input,
   * which on iOS and Android opens the front camera and removes any route to
   * the photo library: a parent could not pick a photo of their child.
   */
  async function attachPhoto(page: import("@playwright/test").Page, index = 0) {
    return page.evaluate(async (i) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 1600;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#399681";
      ctx.fillRect(0, 0, 1200, 1600);
      const blob: Blob = await new Promise((r) =>
        canvas.toBlob((b) => r(b!), "image/jpeg", 0.9),
      );
      const dt = new DataTransfer();
      dt.items.add(new File([blob], "child.jpg", { type: "image/jpeg" }));
      const input = document.querySelectorAll<HTMLInputElement>('input[type="file"]')[i];
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, index);
  }

  test("a parent can upload a photo, and it lands in their own folder", async ({ page }) => {
    const email = `${unique("photo")}@example.test`;
    await signUpParent(page, email, "Photo Family");

    const [cls] = await sql<{ id: string }[]>`
      select id from class_offerings
       where status = 'published' and registration_mode = 'keiki_coders'
         and capacity - seats_taken >= 1 limit 1`;
    await page.goto(`/register/${cls.id}`);

    // The attribute that broke it. Its absence is the fix, so assert it.
    const input = page.locator('input[type="file"]').first();
    await expect(input).not.toHaveAttribute("capture", /.*/);
    // HEIC is what an iPhone photo library actually contains.
    await expect(input).toHaveAttribute("accept", /heic/);

    await attachPhoto(page);
    await expect(page.getByText(/Saved\. Only Keiki Coders staff/)).toBeVisible({
      timeout: 20_000,
    });

    const [parent] = await sql<{ id: string }[]>`
      select id from parents where email = ${email}`;
    const [object] = await sql<{ name: string; mimetype: string }[]>`
      select name, metadata->>'mimetype' as mimetype
        from storage.objects
       where bucket_id = 'child-photos' and name like ${parent.id + "/%"}`;

    expect(object, "the object exists in storage").toBeTruthy();
    // The first path segment is what the storage policy authorises on.
    expect(object.name.split("/")[0]).toBe(parent.id);
    // Whatever was chosen, what is stored is always JPEG, which is why HEIC on
    // the input does not need the bucket's allowed types widened.
    expect(object.mimetype).toBe("image/jpeg");
  });

  test("a registration cannot be paid for without a photo", async ({ page }) => {
    // The failure that used to be silent: a failed upload left photoPath null,
    // nothing validated it, and the parent paid for a roster entry with a blank
    // where a face should be.
    const email = `${unique("nophoto")}@example.test`;
    await signUpParent(page, email, "No Photo Family");

    const [cls] = await sql<{ id: string; grade_min: number | null }[]>`
      select id, grade_min from class_offerings
       where status = 'published' and registration_mode = 'keiki_coders'
         and capacity - seats_taken >= 1 limit 1`;
    await page.goto(`/register/${cls.id}`);

    await page.locator("#parent-phone").fill("808-555-0100");
    await page.locator("#fn-0").fill("Nophoto");
    await page.locator("#ln-0").fill("Child");
    await page.locator("#grade-0").selectOption(String(cls.grade_min ?? 3));
    await fillDate(page, 0, "2016-05-05");
    await page.locator("#attends-0").check();
    await page.locator("#consent").check();

    await page.getByRole("button", { name: "Continue to payment" }).click();

    const summary = page.locator("#kc-error-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("Photo of");
    await expect(page).toHaveURL(new RegExp(`/register/${cls.id}`));

    // Nothing was created, so nothing has to be cleaned up.
    const orders = await sql<{ n: number }[]>`
      select count(*)::int as n from orders o
        join parents p on p.id = o.parent_id
       where p.email = ${email}`;
    expect(orders[0].n, "no order is created when the form is refused").toBe(0);
  });
});

/**
 * Seats that are held are not seats that are sold.
 *
 * The commercial bug this guards: a class whose last places are open checkouts
 * used to read "Full", so a parent who would have bought closed the tab, and
 * ten minutes later the holds lapsed and the seats sat empty. Both directions
 * matter, so both are asserted: a held-out class must invite them in, and a
 * genuinely sold-out one must not.
 */
test.describe("held seats versus sold seats", () => {
  /** Fill a class to capacity, `held` of those places as live seat holds. */
  async function fillClass(classId: string, held: number) {
    const [{ capacity, seats_taken }] = await sql<
      { capacity: number; seats_taken: number }[]
    >`select capacity, seats_taken from class_offerings where id = ${classId}`;

    const free = capacity - seats_taken;

    // Its own family rather than borrowing one. The suite seeds with
    // --no-families, so `select ... from children limit 1` returns nothing and
    // the fixture died on `child.id` before reaching anything under test.
    const [parent] = await sql<{ id: string }[]>`
      insert into parents (email, full_name)
      values (${`${unique("seatfill")}@example.test`}, 'Seat Fill')
      returning id`;

    for (let i = 0; i < free; i++) {
      // A distinct child per seat. Enrolments are unique on
      // (class_offering_id, child_id) for live statuses, so reusing one child
      // would silently drop every insert after the first while seats_taken kept
      // climbing, leaving seats_taken > enrolled + held and breaking the very
      // invariant these two tests are about.
      const [child] = await sql<{ id: string }[]>`
        insert into children (parent_id, first_name, last_name, date_of_birth, grade)
        values (${parent.id}, ${`Filler${i}`}, 'Child', '2016-01-01'::date, 3)
        returning id`;
      const [order] = await sql<{ id: string }[]>`
        insert into orders (parent_id, amount_cents, currency, status, idempotency_key)
        values (${parent.id}, 0, 'usd', 'pending', ${`seatstate:${classId}:${i}:${Date.now()}`})
        returning id`;
      const [item] = await sql<{ id: string }[]>`
        insert into order_items (order_id, class_offering_id, child_id, unit_price_cents)
        values (${order.id}, ${classId}, ${child.id}, 0) returning id`;
      // The last `held` of them stay as holds; the rest become enrolments, so
      // the invariant enrolled + held = seats_taken holds either way.
      if (i >= free - held) {
        await sql`insert into seat_holds (order_item_id, class_offering_id, expires_at)
                  values (${item.id}, ${classId}, now() + interval '9 minutes')`;
      } else {
        await sql`insert into enrollments (class_offering_id, child_id, order_item_id, status)
                  values (${classId}, ${child.id}, ${item.id}, 'active')
                  on conflict do nothing`;
      }
      await sql`update class_offerings set seats_taken = seats_taken + 1 where id = ${classId}`;
    }
  }

  test("a class that is only full because of holds still invites a parent in", async ({ page }) => {
    const [cls] = await sql<{ id: string }[]>`
      select c.id from class_offerings c
       where c.status = 'published' and c.registration_mode = 'keiki_coders'
         and c.capacity - c.seats_taken between 2 and 20
         -- No live holds already on it. Earlier specs leave holds behind, and
         -- both assertions below are about exact hold counts, so a class that
         -- arrives with five of somebody else's is not a clean fixture.
         and not exists (
           select 1 from seat_holds sh
            where sh.class_offering_id = c.id and sh.expires_at > now())
       order by random() limit 1`;
    test.skip(!cls, "no sellable class with free seats");

    await fillClass(cls.id, 2);

    const [row] = await sql<{ seats_left: number; seats_held: number }[]>`
      select seats_left, seats_held from offering_details where id = ${cls.id}`;
    expect(row.seats_left, "the class is full on paper").toBe(0);
    expect(row.seats_held, "but two of those places are only held").toBe(2);

    // The public catalogue is cached for thirty seconds by tag, and this
    // fixture writes seats straight to the database instead of going through
    // the app, so nothing called updateTag. Polling rather than sleeping means
    // this passes the moment the window turns over, and it documents a real
    // property of the product: a seat count on a public page can be up to half
    // a minute stale. Overselling is prevented by the database, never by that
    // number being small.
    await expect
      .poll(
        async () => {
          await page.goto(`/programs/${cls.id}`, { waitUntil: "domcontentloaded" });
          return page.getByText(/in someone else's checkout/i).count();
        },
        { timeout: 45_000, message: "the cached class page should catch up" },
      )
      .toBeGreaterThan(0);

    // The words a parent reads. "Full" on its own is what loses the lead.
    await expect(page.getByText(/Full for the moment/i)).toBeVisible();

    // And the way out is still open, because the transaction refuses safely if
    // the seat has genuinely gone.
    const cta = page.getByRole("link", { name: /Try for a held seat/i });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", `/register/${cls.id}`);
  });

  test("a class where every seat is paid for says so, and offers no way in", async ({ page }) => {
    const [cls] = await sql<{ id: string }[]>`
      select c.id from class_offerings c
       where c.status = 'published' and c.registration_mode = 'keiki_coders'
         and c.capacity - c.seats_taken between 2 and 20
         -- No live holds already on it. Earlier specs leave holds behind, and
         -- both assertions below are about exact hold counts, so a class that
         -- arrives with five of somebody else's is not a clean fixture.
         and not exists (
           select 1 from seat_holds sh
            where sh.class_offering_id = c.id and sh.expires_at > now())
       order by random() limit 1`;
    test.skip(!cls, "no sellable class with free seats");

    await fillClass(cls.id, 0);

    const [row] = await sql<{ seats_held: number; seats_confirmed: number }[]>`
      select seats_held, seats_confirmed from offering_details where id = ${cls.id}`;
    expect(row.seats_held, "nothing is merely held").toBe(0);

    // Same thirty second catalogue cache as the test above.
    await expect
      .poll(
        async () => {
          await page.goto(`/programs/${cls.id}`, { waitUntil: "domcontentloaded" });
          return page.getByText(/places are taken and paid for/i).count();
        },
        { timeout: 45_000, message: "the cached class page should catch up" },
      )
      .toBeGreaterThan(0);

    await expect(page.getByRole("link", { name: /Register for this class/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Try for a held seat/i })).toHaveCount(0);
  });
});

/**
 * The countdown on the checkout.
 *
 * A hold is a promise with a deadline, and before this the deadline was
 * invisible: a parent who went to find their card came back to a page that
 * looked identical whether they had eight minutes left or none.
 */
test("the checkout shows how long the seats are held for", async ({ page }) => {
  const email = `${unique("timer")}@example.test`;
  await signUpParent(page, email, "Timer Family");
  const target = await freeClass(1);

  await page.goto(`/register/${target.id}`);
  // The phone is a parent field, so fillRegistration does not touch it. It is
  // required, and leaving it out puts the form in its error state rather than
  // reaching checkout at all.
  await page.locator("#parent-phone").fill("808-555-0166");
  await fillRegistration(
    page,
    0,
    { first: "Tick", last: unique("Kid").replace(/-/g, ""), dob: "2016-03-03" },
    target,
  );
  await page.locator("#consent").check();
  await page.getByRole("button", { name: /Continue to payment/i }).click();

  // mm:ss, counting down, above the card fields.
  // The digits only. The element also carries a screen reader sentence.
  const clock = page.locator(".kc-hold-digits");
  await expect(clock).toBeVisible({ timeout: 45_000 });
  await expect(clock).toHaveText(/^\d{2}:\d{2}$/);

  // It is the real hold, not a number invented in the browser: within a minute
  // of HOLD_MINUTES, and never longer than it.
  const [mm, ss] = (await clock.innerText()).split(":").map(Number);
  const seconds = mm * 60 + ss;
  expect(seconds).toBeGreaterThan((HOLD_MINUTES - 1) * 60);
  expect(seconds).toBeLessThanOrEqual(HOLD_MINUTES * 60);

  // And it is actually running.
  const first = await clock.innerText();
  await page.waitForTimeout(2200);
  expect(await clock.innerText(), "the clock ticks").not.toBe(first);
});
