/**
 * Seed the local database.
 *
 * Creates the catalogue, materialises every session, mirrors each class into
 * Stripe as a Product and a Price, and creates one staff login.
 *
 *   pnpm seed
 *
 * Safe to re-run, and re-running keeps the same class ids.
 *
 * That last part matters more than it sounds. This used to truncate the
 * catalogue and insert fresh rows, which minted a new uuid for every class on
 * every run. The Playwright suite reseeds in global setup, so running the tests
 * invalidated every /register/<id> link anyone had open, and clicking Register
 * returned a 404. The catalogue is now upserted on its natural key, campus plus
 * title plus term, so ids survive.
 *
 * Only the operational tables are cleared: families, orders, holds and
 * enrollments. Nothing in Stripe is deleted, because Stripe objects are
 * archived rather than deleted, which is exactly the behaviour we want from a
 * system of record for money. Stable class ids also stop it creating a
 * duplicate Product and Price on every run.
 */
import "dotenv/config";
import postgres from "postgres";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, onnotice: () => {} });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-08-26.dahlia",
});
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const STAFF_EMAIL = "ops@keikicoders.test";
const STAFF_PASSWORD = "KeikiOps!2026";

/** Schools named publicly on keikicoders.com as partner campuses. */
const SCHOOLS = [
  { name: "Iolani School" },
  { name: "Maryknoll School" },
  { name: "Kalani High School" },
];

type ClassSeed = {
  school: string;
  title: string;
  summary: string;
  weekday: number; // 0 Sunday .. 6 Saturday
  start: string;
  end: string;
  weeks: number;
  firstSession: string;
  capacity: number;
  priceCents: number;
};

/**
 * Their own example from the brief is "Tuesdays 3-4pm for 10 weeks", so the
 * flagship class uses exactly that, at exactly 12 seats, which is the number
 * in their oversell question.
 */
const CLASSES: ClassSeed[] = [
  {
    school: "Iolani School",
    title: "Scratch Adventures",
    summary: "First code. Storytelling, loops and characters in Scratch. Ages 6 to 9.",
    weekday: 2,
    start: "15:00",
    end: "16:00",
    weeks: 10,
    firstSession: "2026-09-15",
    capacity: 12,
    priceCents: 32000,
  },
  {
    school: "Iolani School",
    title: "Roblox Studio Lab",
    summary: "Build and publish a playable world. Lua scripting from scratch. Ages 9 to 13.",
    weekday: 4,
    start: "15:15",
    end: "16:30",
    weeks: 10,
    firstSession: "2026-09-17",
    capacity: 16,
    priceCents: 38000,
  },
  {
    school: "Maryknoll School",
    title: "Minecraft Modding",
    summary: "Write real mods, break things, fix them. Ages 9 to 13.",
    weekday: 3,
    start: "15:00",
    end: "16:00",
    weeks: 10,
    firstSession: "2026-09-16",
    capacity: 14,
    priceCents: 34000,
  },
  {
    school: "Maryknoll School",
    title: "Robotics with LEGO SPIKE",
    summary: "Build a robot, program it, race it. Teams of two. Ages 8 to 12.",
    weekday: 1,
    start: "15:30",
    end: "17:00",
    weeks: 8,
    firstSession: "2026-09-14",
    capacity: 10,
    priceCents: 42000,
  },
  {
    school: "Kalani High School",
    title: "Python Starters",
    summary: "Real Python, real programs. Ages 12 and up.",
    weekday: 2,
    start: "16:00",
    end: "17:15",
    weeks: 10,
    firstSession: "2026-09-15",
    capacity: 18,
    priceCents: 36000,
  },
  {
    school: "Kalani High School",
    title: "Web Design Basics",
    summary: "HTML, CSS and a site of their own online by week ten. Ages 11 and up.",
    weekday: 4,
    start: "16:00",
    end: "17:00",
    weeks: 10,
    firstSession: "2026-09-17",
    capacity: 20,
    priceCents: 33000,
  },
];

/**
 * Sessions are materialised rows rather than a recurrence rule evaluated at read
 * time, because holidays cancel one week and reschedules move another. An
 * exception needs somewhere to live.
 */
function sessionDates(firstSession: string, weeks: number, start: string, end: string) {
  const out: { seq: number; startsAt: Date; endsAt: Date }[] = [];
  for (let i = 0; i < weeks; i++) {
    const day = new Date(`${firstSession}T00:00:00-10:00`); // Hawaii has no DST
    day.setUTCDate(day.getUTCDate() + i * 7);
    const iso = day.toISOString().slice(0, 10);
    out.push({
      seq: i + 1,
      startsAt: new Date(`${iso}T${start}:00-10:00`),
      endsAt: new Date(`${iso}T${end}:00-10:00`),
    });
  }
  return out;
}

async function main() {
  // Families, money and seats go. The catalogue stays, and is updated in place.
  console.log("Clearing families, orders and seats...");
  await sql`truncate table enrollment_events, webhook_events, seat_holds, enrollments,
            order_items, orders, children, parents
            restart identity cascade`;
  await sql`update class_offerings set seats_taken = 0`;

  console.log("Upserting schools...");
  const schoolIds = new Map<string, string>();
  for (const s of SCHOOLS) {
    const [row] = await sql<{ id: string }[]>`
      insert into schools (name, timezone) values (${s.name}, 'Pacific/Honolulu')
      on conflict (lower(name)) do update set timezone = excluded.timezone
      returning id`;
    schoolIds.set(s.name, row.id);
  }

  console.log("Upserting classes, sessions and Stripe prices...");
  for (const c of CLASSES) {
    // Upsert on the natural key, so the id is the one it had last time.
    const [cls] = await sql<
      { id: string; stripe_product_id: string | null; stripe_price_id: string | null }[]
    >`
      insert into class_offerings
        (school_id, title, summary, term, weekday, start_time, end_time, weeks,
         first_session_date, capacity, price_cents, registration_opens_at, status)
      values
        (${schoolIds.get(c.school)!}, ${c.title}, ${c.summary}, 'Fall 2026', ${c.weekday},
         ${c.start}, ${c.end}, ${c.weeks}, ${c.firstSession}, ${c.capacity},
         ${c.priceCents}, now() - interval '1 day', 'published')
      on conflict (school_id, lower(title), term) do update
        set summary = excluded.summary,
            weekday = excluded.weekday,
            start_time = excluded.start_time,
            end_time = excluded.end_time,
            weeks = excluded.weeks,
            first_session_date = excluded.first_session_date,
            capacity = excluded.capacity,
            price_cents = excluded.price_cents,
            registration_opens_at = excluded.registration_opens_at,
            status = excluded.status
      returning id, stripe_product_id, stripe_price_id`;

    // Sessions are keyed by sequence within the class, so a reseed rewrites the
    // dates in place rather than stacking a second term on top of the first.
    const dates = sessionDates(c.firstSession, c.weeks, c.start, c.end);
    for (const s of dates) {
      await sql`insert into sessions (class_offering_id, seq, starts_at, ends_at, status)
                values (${cls.id}, ${s.seq}, ${s.startsAt}, ${s.endsAt}, 'scheduled')
                on conflict (class_offering_id, seq) do update
                  set starts_at = excluded.starts_at,
                      ends_at = excluded.ends_at,
                      status = 'scheduled',
                      rescheduled_from = null,
                      note = null`;
    }
    // Anything left from a longer previous term, or from a reschedule.
    await sql`delete from sessions
               where class_offering_id = ${cls.id} and seq > ${dates.length}`;

    // Our database owns the class. Stripe mirrors it, and holds the money truth.
    // Reuse the existing Product and Price when the amount has not moved: a new
    // Price for an unchanged amount is clutter in an account that is meant to be
    // a system of record.
    let productId = cls.stripe_product_id;
    let priceId = cls.stripe_price_id;

    const currentPrice = priceId
      ? await stripe.prices.retrieve(priceId).catch(() => null)
      : null;
    const priceMatches =
      currentPrice?.unit_amount === c.priceCents && currentPrice?.active === true;

    if (!productId) {
      const product = await stripe.products.create(
        {
          name: `${c.title} (${c.school})`,
          description: c.summary,
          metadata: { class_offering_id: cls.id, term: "Fall 2026" },
        },
        { idempotencyKey: `product:${cls.id}` },
      );
      productId = product.id;
    }

    if (!priceMatches) {
      // A price change mints a new Price and repoints. Stripe Prices are
      // immutable, and the old one stays attached to the orders that used it.
      const price = await stripe.prices.create(
        {
          product: productId,
          unit_amount: c.priceCents,
          currency: "usd",
          metadata: { class_offering_id: cls.id },
        },
        { idempotencyKey: `price:${cls.id}:${c.priceCents}` },
      );
      priceId = price.id;
    }

    await sql`update class_offerings
                 set stripe_product_id = ${productId}, stripe_price_id = ${priceId}
               where id = ${cls.id}`;

    console.log(`  ${c.title} at ${c.school}: ${c.capacity} seats, ${priceId}`);
  }

  console.log("Creating staff login...");
  const { data: existing } = await admin.auth.admin.listUsers();
  const found = existing?.users.find((u) => u.email === STAFF_EMAIL);
  let authUserId = found?.id;
  if (!authUserId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: STAFF_EMAIL,
      password: STAFF_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    authUserId = data.user!.id;
  }
  await sql`insert into staff (auth_user_id, email, full_name)
            values (${authUserId!}, ${STAFF_EMAIL}, 'Keiki Ops')
            on conflict (auth_user_id) do nothing`;

  console.log(`\nDone.`);
  console.log(`  Staff login: ${STAFF_EMAIL} / ${STAFF_PASSWORD}`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
