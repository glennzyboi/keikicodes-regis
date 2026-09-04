/**
 * Put the database into a known, demonstrable state.
 *
 * The catalogue is no longer invented. It is imported from Keiki Coders' own
 * published records, so the demo runs on 19 real campuses and 28 real
 * offerings, with their real grades, times, terms, holidays and prices, and
 * with the 15 offerings that their partner schools register themselves
 * correctly marked as not ours to sell. Six imaginary classes proved nothing
 * about whether the model fits their business.
 *
 * What this script owns beyond the import:
 *
 *   - clearing the operational tables, so a run never inherits the last one
 *   - pruning offerings that are no longer in their catalogue
 *   - mirroring the sellable offerings into Stripe as Products and Prices
 *   - the two logins the demo is driven with
 *
 * The catalogue is upserted on its natural key rather than recreated, so class
 * ids survive a reseed and a link somebody has open still resolves. That was a
 * real bug once: reseeding minted new ids and every open registration page
 * 404ed.
 *
 * Nothing in Stripe is ever deleted. Stripe objects are archived rather than
 * removed, which is exactly the behaviour you want from a system of record for
 * money.
 */
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
// The shared client, not a second one. This script used to open its own while
// the importer used core's, so sql.end() closed the wrong pool and the process
// hung after printing "Done". It cost a ten minute test run to find.
import { sql } from "../src/db";
import { importCatalogue } from "../src/catalogue/import";
import { chooseSource, printReport } from "./import-catalogue";
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

/** A parent account to sign in as, so the flow can be shown without signing up
 *  first every time the database is reset. */
const DEMO_PARENT_EMAIL = "parent@keikicoders.test";
const DEMO_PARENT_PASSWORD = "KeikiParent!2026";
const DEMO_PARENT_NAME = "Malia Kealoha";

/**
 * Create the auth user, or reset its password if it is already there.
 *
 * listUsers() is paginated, which broke this once: after a few suite runs the
 * ops account fell off the first page and the seed tried to create an account
 * that already existed. Asking Postgres is both correct and cheaper.
 */
async function ensureAuthUser(
  email: string,
  password: string,
  metadata: Record<string, unknown>,
): Promise<string> {
  const [existing] = await sql<{ id: string }[]>`
    select id from auth.users where lower(email) = lower(${email}) limit 1`;

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      user_metadata: metadata,
    });
    if (error) throw error;
    return existing.id;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error) throw error;
  return data.user!.id;
}

async function main() {
  const useSnapshot = process.argv.includes("--snapshot");

  // Families, money and seats go. The catalogue stays and is updated in place.
  console.log("Clearing families, orders and seats...");
  await sql`truncate table enrollment_events, webhook_events, seat_holds, enrollments,
            order_items, orders, consents, guardians, children, parents,
            notifications, support_notes
            restart identity cascade`;
  await sql`update class_offerings set seats_taken = 0`;

  // Sessions somebody cancelled or rescheduled by hand are family-facing
  // decisions, and generate_sessions deliberately preserves them. That is right
  // in production and wrong in a seed, whose whole job is a known state, so
  // they are cleared here and only here. Without this, two seed runs produce
  // different session counts and nobody can tell why.
  await sql`delete from sessions where origin = 'manual'`;
  await sql`update sessions set status = 'scheduled', note = null,
                                from_blackout = false, rescheduled_from = null
             where status <> 'scheduled' or note is not null`;

  console.log("Importing their catalogue...");
  const source = await chooseSource(!useSnapshot);
  const report = await importCatalogue({ source });
  printReport(report);

  // Anything we hold that is no longer in their catalogue. Safe here because
  // the operational tables were just emptied; in the admin console the same
  // decision is a human's, not a script's.
  const keep = report.offerings.map((o) => o.id);
  const stale = await sql<{ id: string; title: string }[]>`
    delete from class_offerings c
     where c.id <> all(${sql.array(keep)}::uuid[])
    returning c.id, c.title`;
  const staleSchools = await sql<{ id: string }[]>`
    delete from schools s
     where s.id <> all(${sql.array(report.schoolIds)}::uuid[])
    returning s.id`;
  const orphanPrograms = await sql<{ id: string }[]>`
    delete from programs p
     where not exists (select 1 from class_offerings c where c.program_id = p.id)
    returning p.id`;
  if (stale.length || orphanPrograms.length || staleSchools.length) {
    console.log(
      `Pruned ${stale.length} offerings, ${orphanPrograms.length} programs and ` +
        `${staleSchools.length} schools no longer in their catalogue.`,
    );
  }

  // Stripe mirrors the catalogue; our database owns it. Only the offerings we
  // actually sell get a Product, because minting one for a class a partner
  // school registers would be an invitation to charge for it by accident.
  console.log("Mirroring sellable offerings into Stripe...");
  const sellable = await sql<
    {
      id: string;
      title: string;
      school: string;
      summary: string | null;
      price_cents: number;
      stripe_product_id: string | null;
      stripe_price_id: string | null;
    }[]
  >`select c.id, c.title, s.name as school, c.summary, c.price_cents,
           c.stripe_product_id, c.stripe_price_id
      from class_offerings c join schools s on s.id = c.school_id
     where c.registration_mode = 'keiki_coders' and c.price_cents is not null
     order by s.name, c.title`;

  for (const c of sellable) {
    let productId = c.stripe_product_id;
    let priceId = c.stripe_price_id;

    const currentPrice = priceId ? await stripe.prices.retrieve(priceId).catch(() => null) : null;
    const priceMatches =
      currentPrice?.unit_amount === c.price_cents && currentPrice?.active === true;

    if (!productId) {
      const product = await stripe.products.create(
        {
          name: `${c.title} (${c.school})`,
          description: c.summary?.slice(0, 500) ?? undefined,
          metadata: { class_offering_id: c.id },
        },
        { idempotencyKey: `product:${c.id}` },
      );
      productId = product.id;
    }

    if (!priceMatches) {
      // A price change mints a new Price and repoints. Stripe Prices are
      // immutable, and the old one stays attached to the orders that used it.
      const price = await stripe.prices.create(
        {
          product: productId,
          unit_amount: c.price_cents,
          currency: "usd",
          metadata: { class_offering_id: c.id },
        },
        { idempotencyKey: `price:${c.id}:${c.price_cents}` },
      );
      priceId = price.id;
    }

    await sql`update class_offerings
                 set stripe_product_id = ${productId}, stripe_price_id = ${priceId}
               where id = ${c.id}`;
  }
  console.log(`  ${sellable.length} offerings priced in Stripe.`);

  console.log("Creating logins...");
  const staffAuthId = await ensureAuthUser(STAFF_EMAIL, STAFF_PASSWORD, {
    full_name: "Keiki Ops",
  });
  await sql`insert into staff (auth_user_id, email, full_name)
            values (${staffAuthId}, ${STAFF_EMAIL}, 'Keiki Ops')
            on conflict (auth_user_id) do nothing`;

  // A parent account, linked to a parents row by email exactly the way a real
  // signup would link it.
  const parentAuthId = await ensureAuthUser(DEMO_PARENT_EMAIL, DEMO_PARENT_PASSWORD, {
    full_name: DEMO_PARENT_NAME,
  });
  await sql`insert into parents (auth_user_id, email, full_name, phone)
            values (${parentAuthId}, ${DEMO_PARENT_EMAIL}, ${DEMO_PARENT_NAME}, '808-555-0142')
            on conflict (email) do update
              set auth_user_id = excluded.auth_user_id,
                  full_name = excluded.full_name`;

  const [counts] = await sql<
    { schools: number; programs: number; offerings: number; sellable: number; sessions: number }[]
  >`select (select count(*) from schools)::int                              as schools,
           (select count(*) from programs)::int                             as programs,
           (select count(*) from class_offerings)::int                      as offerings,
           (select count(*) from class_offerings
             where registration_mode = 'keiki_coders')::int                 as sellable,
           (select count(*) from sessions where status = 'scheduled')::int  as sessions`;

  console.log("Done.");
  console.log(
    `  ${counts.schools} schools, ${counts.programs} programs, ${counts.offerings} offerings ` +
      `(${counts.sellable} sold here), ${counts.sessions} sessions.`,
  );
  console.log(`  Staff:  ${STAFF_EMAIL} / ${STAFF_PASSWORD}`);
  console.log(`  Parent: ${DEMO_PARENT_EMAIL} / ${DEMO_PARENT_PASSWORD}`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
