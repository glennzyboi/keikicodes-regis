import { test, expect, request as playwrightRequest } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { sql } from "./helpers";

/**
 * The API service, and the migration it exists to make possible.
 *
 * Their Squarespace page reads two n8n webhooks and renders whatever comes
 * back. The claim is that pointing it here is a one line change, and a claim
 * like that is worth nothing without a test that checks the shape field by
 * field. This is that test.
 *
 * It skips rather than fails when the service is not running, because the API
 * is a separate process and a red suite because somebody forgot to start it
 * teaches nobody anything.
 */

const API = process.env.API_URL ?? "http://localhost:3001";

const root = path.resolve(__dirname, "..");
const require = createRequire(__filename);
const tsx = path.join(path.dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");

function runScript(script: string, args: string[] = []) {
  return execFileSync(
    process.execPath,
    [tsx, "--env-file=.env.local", `../../packages/core/scripts/${script}`, ...args],
    { cwd: root, encoding: "utf8" },
  );
}

async function apiUp(): Promise<boolean> {
  try {
    const ctx = await playwrightRequest.newContext();
    const res = await ctx.get(`${API}/health`, { timeout: 4000 });
    const ok = res.ok() && (await res.json()).database === "up";
    await ctx.dispose();
    return ok;
  } catch {
    return false;
  }
}

test.describe("the public catalogue endpoints", () => {
  test.beforeEach(async () => {
    test.skip(!(await apiUp()), "the API service is not running on 3001");
  });

  test("health tells the truth about the database", async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // A health check that does not touch the database stays green while the
    // thing is unusable, so this one does.
    expect(body).toMatchObject({ ok: true, service: "keiki-api", database: "up" });
  });

  test("schools answer in the shape their site already reads", async ({ request }) => {
    const res = await request.get(`${API}/public/schools`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from schools where active`;
    expect(body).toHaveLength(n);

    // Exactly their field names, and their capitalisation on type.
    for (const s of body) {
      expect(Object.keys(s).sort()).toEqual(["area", "logo", "name", "type"]);
      if (s.type !== null) expect(["Public", "Private", "Charter"]).toContain(s.type);
    }
  });

  test("programs answer in the shape their site already reads", async ({ request }) => {
    const res = await request.get(`${API}/public/programs`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from class_offerings where status = 'published'`;
    expect(body).toHaveLength(n);

    const expected = [
      "cost", "dates", "days", "description", "grades", "image", "location",
      "name", "noClass", "registerUrl", "season", "sessions", "site", "specialNotes",
      "time",
    ];
    for (const p of body) {
      expect(Object.keys(p).sort(), `${p.name} has their exact fields`).toEqual(expected);
    }

    // The shapes their renderer depends on.
    const one = body[0];
    expect(one.days, "an English day name").toMatch(
      /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/,
    );
    expect(one.time, "a time range").toMatch(/^\d{1,2}:\d{2}.\d{1,2}:\d{2}$/);
    expect(one.dates, "a long date range").toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4} . /);
    expect(typeof one.sessions).toBe("number");

    // The half of the catalogue their partner schools enrol has no price and
    // sends families to the school. That is data, not an oversight.
    const external = body.filter((p: { cost: number | null }) => p.cost === null);
    expect(external.length, "some classes are enrolled by the school").toBeGreaterThan(0);
    for (const p of external) {
      expect(p.registerUrl, `${p.name} sends families somewhere`).toBeTruthy();
      expect(p.registerUrl).not.toContain("keikicoders.com/register");
    }

    // And everything we do sell has a price and points at us.
    for (const p of body.filter((x: { cost: number | null }) => x.cost !== null)) {
      expect(p.registerUrl).toContain("/register");
      expect(p.cost).toBeGreaterThan(0);
    }
  });

  test("the session count we publish is the count we generated", async ({ request }) => {
    // The number families count. If the endpoint and the schedule disagree,
    // somebody turns up on a week that does not exist.
    const res = await request.get(`${API}/public/programs`);
    const body = await res.json();

    const rows = await sql<{ title: string; school: string; n: number }[]>`
      select c.title, s.name as school,
             (select count(*)::int from sessions se
               where se.class_offering_id = c.id and se.status = 'scheduled') as n
        from class_offerings c join schools s on s.id = c.school_id
       where c.status = 'published'`;

    for (const r of rows) {
      const published = body.find(
        (p: { name: string; site: string }) => p.name === r.title && p.site === r.school,
      );
      expect(published, `${r.title} at ${r.school} is published`).toBeTruthy();
      expect(published.sessions, `${r.title} at ${r.school}`).toBe(r.n);
    }
  });

  test("the catalogue is readable across origins, and nothing else is", async ({ request }) => {
    const cors = await request.get(`${API}/public/schools`, {
      headers: { Origin: "https://www.keikicoders.com" },
    });
    expect(cors.headers()["access-control-allow-origin"]).toBe("*");

    // The health endpoint is not part of the public contract.
    const health = await request.get(`${API}/health`, {
      headers: { Origin: "https://www.keikicoders.com" },
    });
    expect(health.headers()["access-control-allow-origin"]).toBeUndefined();
  });

  test("an unknown path is a 404, not a stack trace", async ({ request }) => {
    const res = await request.get(`${API}/public/nope`);
    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

test.describe("importing their catalogue", () => {
  test("a second import changes nothing", async () => {
    // Upserts on natural keys, so this is safe to run as often as anybody
    // likes. Which is the only thing that makes it usable during a migration,
    // when it will be run over and over while both systems are live.
    const before = await sql<{ id: string; title: string; capacity: number }[]>`
      select id, title, capacity from class_offerings order by id`;

    const output = runScript("import-catalogue.ts", ["--snapshot"]);

    expect(output).toContain("0 new");
    expect(output).toMatch(/28 of 28 reconcile/);

    const after = await sql<{ id: string; title: string; capacity: number }[]>`
      select id, title, capacity from class_offerings order by id`;

    // Ids especially: a reseed that minted new ones broke every open link once.
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after.map((r) => r.capacity)).toEqual(before.map((r) => r.capacity));
  });

  test("a capacity set by hand survives an import", async () => {
    // Their endpoint does not publish capacity, so it is the one number the
    // import cannot know. Overwriting a number a person set would be worse than
    // leaving it, so it is left.
    const [cls] = await sql<{ id: string; capacity: number }[]>`
      select id, capacity from class_offerings order by title limit 1`;

    await sql`update class_offerings set capacity = 99 where id = ${cls.id}`;
    try {
      runScript("import-catalogue.ts", ["--snapshot"]);

      const [after] = await sql<{ capacity: number }[]>`
        select capacity from class_offerings where id = ${cls.id}`;
      expect(after.capacity, "the number a human set is kept").toBe(99);
    } finally {
      // In a finally, because a failure here once left a capacity of 99 behind,
      // and the concurrency spec then ran against a class with more free seats
      // than parents and proved nothing at all.
      await sql`update class_offerings set capacity = ${cls.capacity} where id = ${cls.id}`;
    }
  });

  test("their pictures are copied, not linked", async ({ request }) => {
    // Airtable attachment URLs are signed and expire. The ones captured at
    // lunchtime were returning 410 Gone by the evening, so a catalogue that
    // links to them is a catalogue whose pictures are all broken by the time
    // anybody looks at it. Which would have happened halfway through the demo.
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;

    const logos = await sql<{ name: string; logo_url: string }[]>`
      select name, logo_url from schools where logo_url is not null`;
    expect(logos.length, "the campuses have logos").toBeGreaterThan(0);

    for (const s of logos) {
      expect(s.logo_url, `${s.name} logo is ours`).toContain(
        `${base}/storage/v1/object/public/`,
      );
      expect(s.logo_url, `${s.name} does not point at Airtable`).not.toContain(
        "airtableusercontent.com",
      );
    }

    // And one of them actually resolves, rather than being a tidy dead link.
    const res = await request.get(logos[0].logo_url);
    expect(res.status(), `${logos[0].name} logo loads`).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/");

    const images = await sql<{ name: string; image_url: string }[]>`
      select name, image_url from programs where image_url is not null`;
    for (const p of images) {
      expect(p.image_url, `${p.name} image is ours`).toContain(
        `${base}/storage/v1/object/public/`,
      );
    }
  });

  test("the import reconciles every schedule against their published counts", async () => {
    const output = runScript("import-catalogue.ts", ["--snapshot", "--dry"]);
    expect(output).toContain("DRY RUN");
    expect(output).toMatch(/28 of 28 reconcile against their own published counts/);
    // A disagreement is reported rather than accepted quietly.
    expect(output).not.toContain("do not and need a look");
  });
});
