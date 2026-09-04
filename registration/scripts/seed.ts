/**
 * Seed the local database.
 *
 * Creates the catalogue, materialises every session, mirrors each class into
 * Stripe as a Product and a Price, and creates one staff login.
 *
 *   pnpm seed
 *
 * Safe to re-run: it clears the operational tables first. It does not delete
 * anything in Stripe, because Stripe objects are archived rather than deleted,
 * which is exactly the behaviour we want from a system of record for money.
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
  console.log("Clearing operational tables...");
  await sql`truncate table enrollment_events, webhook_events, seat_holds, enrollments,
            order_items, orders, children, parents, sessions, class_offerings, schools
            restart identity cascade`;

  console.log("Creating schools...");
  const schoolIds = new Map<string, string>();
  for (const s of SCHOOLS) {
    const [row] = await sql<{ id: string }[]>`
      insert into schools (name, timezone) values (${s.name}, 'Pacific/Honolulu')
      returning id`;
    schoolIds.set(s.name, row.id);
  }

  console.log("Creating classes, sessions and Stripe prices...");
  for (const c of CLASSES) {
    const [cls] = await sql<{ id: string }[]>`
      insert into class_offerings
        (school_id, title, summary, term, weekday, start_time, end_time, weeks,
         first_session_date, capacity, price_cents, registration_opens_at, status)
      values
        (${schoolIds.get(c.school)!}, ${c.title}, ${c.summary}, 'Fall 2026', ${c.weekday},
         ${c.start}, ${c.end}, ${c.weeks}, ${c.firstSession}, ${c.capacity},
         ${c.priceCents}, now() - interval '1 day', 'published')
      returning id`;

    for (const s of sessionDates(c.firstSession, c.weeks, c.start, c.end)) {
      await sql`insert into sessions (class_offering_id, seq, starts_at, ends_at)
                values (${cls.id}, ${s.seq}, ${s.startsAt}, ${s.endsAt})`;
    }

    // Our database owns the class. Stripe mirrors it, and holds the money truth.
    const product = await stripe.products.create(
      {
        name: `${c.title} (${c.school})`,
        description: c.summary,
        metadata: { class_offering_id: cls.id, term: "Fall 2026" },
      },
      { idempotencyKey: `product:${cls.id}` },
    );
    const price = await stripe.prices.create(
      {
        product: product.id,
        unit_amount: c.priceCents,
        currency: "usd",
        metadata: { class_offering_id: cls.id },
      },
      { idempotencyKey: `price:${cls.id}:${c.priceCents}` },
    );
    await sql`update class_offerings
                 set stripe_product_id = ${product.id}, stripe_price_id = ${price.id}
               where id = ${cls.id}`;

    console.log(`  ${c.title} at ${c.school}: ${c.capacity} seats, ${price.id}`);
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
