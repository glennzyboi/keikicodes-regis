import type { Sql } from "postgres";

/**
 * A believable set of families, so the console looks like a system somebody uses.
 *
 * Before this the seed made exactly one demo parent and every other row in the
 * database came from whatever the test suite had left behind:
 * `parent-1788619...@example.test`, children called "Findme Kaeo1788613368",
 * and an office screen that looked like a fixture rather than a product. That is
 * a bad way to evaluate a tool, and a worse way to notice that a column is too
 * narrow or that a name wraps.
 *
 * The names are ordinary O'ahu names rather than Person A and Person B, and the
 * addresses are the consumer mail domains real families actually use, because
 * "does this look right" is a question you can only answer against data that
 * looks right.
 *
 * **Nothing here is ever emailed.** Local development delivers to Mailpit, and
 * `seedFamilies` refuses to run against anything but a local database, which is
 * the guard that makes realistic addresses safe to use. Real looking is the
 * point; real is not.
 */

const PARENTS = [
  ["Malia", "Kealoha"], ["Keanu", "Nakamura"], ["Leilani", "Silva"],
  ["Kai", "Fernandez"], ["Noelani", "Wong"], ["Ikaika", "Tanaka"],
  ["Alana", "Cabral"], ["Makoa", "Chang"], ["Pua", "Medeiros"],
  ["Nainoa", "Akana"], ["Anela", "Lum"], ["Kekoa", "Rodrigues"],
  ["Hoku", "Yamamoto"], ["Kalani", "Souza"], ["Lani", "Correa"],
  ["Koa", "Freitas"], ["Maile", "Kanahele"], ["Ekolu", "Pang"],
  ["Iolana", "Kamaka"], ["Nohea", "Ho"], ["Kaimana", "Makekau"],
  ["Sione", "Naeole"], ["Hina", "Kahananui"], ["Marcus", "Delacruz"],
  ["Jenny", "Higa"], ["Ryan", "Oshiro"], ["Tiare", "Bautista"],
  ["Devon", "Aiona"], ["Kanoe", "Furtado"], ["Bryson", "Kaneshiro"],
  ["Shaye", "Perreira"], ["Aulii", "Duarte"], ["Trevor", "Miyashiro"],
  ["Malie", "Kekoa"], ["Jordan", "Texeira"], ["Puanani", "Lopes"],
] as const;

const CHILD_NAMES = [
  "Nalu", "Maile", "Kaimana", "Lehua", "Ekolu", "Hina", "Aolani", "Milo",
  "Koa", "Sela", "Kaiea", "Nika", "Theo", "Ruby", "Iolani", "Kanoa",
  "Makana", "Noa", "Leo", "Kiana", "Ari", "Mele", "Zion", "Hoku",
];

const DOMAINS = ["gmail.com", "gmail.com", "gmail.com", "yahoo.com", "hotmail.com", "icloud.com"];

const CARE = ["A+", "W+", "Another after school program"];

/**
 * Notes an office would actually hold, rather than lorem ipsum.
 *
 * Deliberately a mix of medical, practical and pickup, because those are the
 * three kinds a roster has to surface before a session rather than after.
 */
const NOTES = [
  "Peanut allergy. Carries an EpiPen in his bag, front pocket.",
  "Asthma. Inhaler is with the school office.",
  "Wears glasses for screen work, sometimes forgets them.",
  "Collected by grandma on Wednesdays.",
  "Shy for the first few sessions, warms up quickly.",
  "Left handed, needs a left handed mouse if there is one.",
  "Mild eczema, avoid the scented hand soap.",
  "Goes back to A+ at the end, do not release to the car park.",
];

/** A deterministic shuffle, so two seed runs produce the same database. */
function pick<T>(list: readonly T[], n: number): T {
  return list[n % list.length];
}

export type SeededFamilies = {
  parents: number;
  children: number;
  enrolled: number;
  paid: number;
};

export async function seedFamilies(
  sql: Sql,
  opts: {
    classes: { id: string; price_cents: number; capacity: number; seats_taken: number }[];
    /**
     * Deliberately load a remote database with invented families.
     *
     * The default refusal exists because these are realistic addresses and the
     * notification worker would try to write to them. The hosted prototype
     * genuinely wants them — a console with one family in it is impossible to
     * judge — so the escape hatch is a flag somebody has to type, not a check
     * that quietly weakened. It is paired with DEMO_DATA=1 on the deployment,
     * which makes the email transport refuse to deliver at all.
     */
    allowRemote?: boolean;
  },
): Promise<SeededFamilies> {
  // The guard that makes realistic addresses safe. A seed that can invent forty
  // gmail addresses must never be able to point at a real deployment by
  // accident, because the notification worker would happily try to write to
  // them.
  const [{ host }] = await sql<{ host: string }[]>`select inet_server_addr()::text as host`;
  const url = process.env.DATABASE_URL ?? "";
  const local = /(^|@)(127\.0\.0\.1|localhost|host\.docker\.internal|::1)/.test(url) || host === "";
  if (!local && !opts.allowRemote) {
    throw new Error(
      `Refusing to seed demo families into a non local database (${url.replace(/:[^:@]*@/, ":***@")}). ` +
        "These are realistic addresses. Pass --allow-remote-demo-data if that is really what you want, " +
        "and set DEMO_DATA=1 on the deployment so nothing can be delivered to them.",
    );
  }

  let childCount = 0;
  let enrolledCount = 0;
  let paidCount = 0;

  // Only classes we actually sell and that still have room. Filling a class the
  // suite then needs a seat in is how a seed starts failing tests.
  const sellable = opts.classes.filter((c) => c.capacity - c.seats_taken > 2);

  for (let i = 0; i < PARENTS.length; i++) {
    const [first, last] = PARENTS[i];
    const email = `${first}.${last}${i % 5 === 0 ? String(60 + i) : ""}@${pick(DOMAINS, i)}`
      .toLowerCase()
      .replace(/[^a-z0-9.@]/g, "");
    const phone = `808-${String(200 + (i * 7) % 700).padStart(3, "0")}-${String(1000 + i * 137).slice(0, 4)}`;

    const [parent] = await sql<{ id: string }[]>`
      insert into parents (email, full_name, phone)
      values (${email}, ${`${first} ${last}`}, ${phone})
      on conflict (email) do update set full_name = excluded.full_name
      returning id`;

    // Written down the moment it is invented, so the notification worker can
    // tell this apart from an address a real parent typed in. See the migration
    // 20260906120000_demo_addresses.sql for why the rule is about the seed
    // rather than about who is allowed to receive mail.
    await sql`
      insert into demo_addresses (address, note)
      values (${email.toLowerCase()}, ${`seeded family: ${first} ${last}`})
      on conflict (address) do nothing`;

    // Most families have one child, a good third have two. That ratio is the
    // reason the registration form takes several children on one order.
    const kids = i % 3 === 0 ? 2 : 1;

    for (let k = 0; k < kids; k++) {
      const n = i * 2 + k;
      const childFirst = pick(CHILD_NAMES, n);
      const grade = 1 + (n % 6);
      // Born so the grade and the age agree, which is the pair the office
      // cross-checks when a parent picks the wrong one.
      const year = new Date().getUTCFullYear() - (grade + 5);
      const dob = `${year}-${String(1 + (n % 12)).padStart(2, "0")}-${String(1 + (n % 27)).padStart(2, "0")}`;

      const inCare = n % 4 === 0;
      const [child] = await sql<{ id: string }[]>`
        insert into children (parent_id, first_name, last_name, date_of_birth, grade,
                              notes, in_afterschool_care, afterschool_care_program)
        values (${parent.id}, ${childFirst}, ${last}, ${dob}::date, ${grade},
                ${n % 5 === 0 ? pick(NOTES, n) : null},
                ${inCare}, ${inCare ? pick(CARE, n) : null})
        returning id`;
      childCount++;

      // Roughly two thirds of children are enrolled in something. The rest are
      // on file from a previous term, which is the state a returning family is
      // in when they come back, and the reason the form can pick a child.
      if (n % 3 !== 2 && sellable.length > 0) {
        const cls = sellable[n % sellable.length];
        const [order] = await sql<{ id: string }[]>`
          insert into orders (parent_id, amount_cents, currency, status, fulfilled_at,
                              idempotency_key, stripe_payment_intent_id)
          values (${parent.id}, ${cls.price_cents}, 'usd', 'paid',
                  now() - (${n} || ' days')::interval,
                  ${`seed:${i}:${k}`}, ${`pi_seed_${i}_${k}`})
          returning id`;

        const [item] = await sql<{ id: string }[]>`
          insert into order_items (order_id, class_offering_id, child_id, unit_price_cents)
          values (${order.id}, ${cls.id}, ${child.id}, ${cls.price_cents})
          returning id`;

        const [firstSession] = await sql<{ id: string }[]>`
          select id from sessions where class_offering_id = ${cls.id}
           order by session_date asc limit 1`;

        await sql`
          insert into enrollments (class_offering_id, child_id, order_item_id, status,
                                   starts_from_session_id)
          values (${cls.id}, ${child.id}, ${item.id}, 'active', ${firstSession?.id ?? null})`;

        // The seat counter is the invariant everything else is checked against,
        // so the seed maintains it exactly as the registration path does.
        await sql`update class_offerings set seats_taken = seats_taken + 1 where id = ${cls.id}`;
        cls.seats_taken += 1;

        enrolledCount++;
        paidCount++;
      }
    }
  }

  return { parents: PARENTS.length, children: childCount, enrolled: enrolledCount, paid: paidCount };
}
