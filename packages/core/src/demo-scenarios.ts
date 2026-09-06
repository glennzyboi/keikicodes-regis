import type { Sql } from "postgres";
import { cancelSessions, moveSession } from "./schedule";

/**
 * The states worth demonstrating, put there on purpose.
 *
 * Seeding forty ordinary families gives a console that looks populated and
 * proves nothing. Every rule in the brief describes a *state* — a child in two
 * classes, a cancellation waiting on a decision, a session moved for a holiday —
 * and if none of those states exist, a demo becomes a description of features
 * rather than a tour of them.
 *
 * So each scenario below exists to make one sentence of the brief clickable, and
 * each one is named after the sentence it serves. They are deterministic: the
 * same families, the same classes, the same dates on every run, so a demo can be
 * re-recorded without re-learning where everything is.
 *
 * Every one of them goes through the same columns the application writes. None
 * of this is a special case the product does not otherwise produce, which is the
 * only way seeded data is worth showing.
 */

export type Scenarios = Record<string, string>;

/** The seat counter is the invariant everything is checked against. */
async function takeSeat(sql: Sql, classId: string) {
  await sql`update class_offerings set seats_taken = seats_taken + 1 where id = ${classId}`;
}

async function enroll(
  sql: Sql,
  opts: {
    parentId: string;
    childId: string;
    classId: string;
    priceCents: number;
    key: string;
    /** Null means from the first session, which is the ordinary case. */
    fromSessionId?: string | null;
    daysAgo?: number;
  },
) {
  const [order] = await sql<{ id: string }[]>`
    insert into orders (parent_id, amount_cents, currency, status, fulfilled_at,
                        idempotency_key, stripe_payment_intent_id)
    values (${opts.parentId}, ${opts.priceCents}, 'usd', 'paid',
            now() - (${opts.daysAgo ?? 5} || ' days')::interval,
            ${`seed:${opts.key}`}, ${`pi_seed_${opts.key}`})
    returning id`;

  const [item] = await sql<{ id: string }[]>`
    insert into order_items (order_id, class_offering_id, child_id, unit_price_cents)
    values (${order.id}, ${opts.classId}, ${opts.childId}, ${opts.priceCents})
    returning id`;

  const [first] = await sql<{ id: string }[]>`
    select id from sessions where class_offering_id = ${opts.classId}
     order by session_date asc limit 1`;

  const [enrollment] = await sql<{ id: string }[]>`
    insert into enrollments (class_offering_id, child_id, order_item_id, status,
                             starts_from_session_id)
    values (${opts.classId}, ${opts.childId}, ${item.id}, 'active',
            ${opts.fromSessionId ?? first?.id ?? null})
    returning id`;

  await takeSeat(sql, opts.classId);
  return { orderId: order.id, itemId: item.id, enrollmentId: enrollment.id };
}

export async function seedScenarios(sql: Sql): Promise<Scenarios> {
  const out: Scenarios = {};

  // The audit columns take an actor id, not an email: `sessions.changed_by` and
  // `session_events.actor_id` are both uuid. Only `enrollments.dropped_by` is
  // text, because that one is read straight off a roster by a person.
  const [staff] = await sql<{ id: string; email: string }[]>`
    select id, email from staff order by created_at asc limit 1`;
  if (!staff) return out;

  const sellable = await sql<
    { id: string; title: string; school: string; price_cents: number; capacity: number; seats_taken: number }[]
  >`select c.id, c.title, s.name as school, c.price_cents, c.capacity, c.seats_taken
      from class_offerings c join schools s on s.id = c.school_id
     where c.status = 'published' and c.registration_mode = 'keiki_coders'
       and c.capacity - c.seats_taken > 3
     order by c.capacity - c.seats_taken desc`;

  if (sellable.length < 4) return out;

  // -------------------------------------------------------------------------
  // "A parent can have multiple children, and a child can be in multiple
  // classes." Both halves, in one family, so it is one click to show.
  // -------------------------------------------------------------------------
  const [kealoha] = await sql<{ id: string; full_name: string }[]>`
    insert into parents (email, full_name, phone)
    values ('noelani.kahananui@gmail.com', 'Noelani Kahananui', '808-372-4418')
    on conflict (email) do update set full_name = excluded.full_name
    returning id, full_name`;

  const [nalu] = await sql<{ id: string }[]>`
    insert into children (parent_id, first_name, last_name, date_of_birth, grade, notes)
    values (${kealoha.id}, 'Nalu', 'Kahananui', '2016-05-11'::date, 4,
            'Peanut allergy. EpiPen lives in the front pocket of his bag.')
    returning id`;
  const [maile] = await sql<{ id: string }[]>`
    insert into children (parent_id, first_name, last_name, date_of_birth, grade,
                          in_afterschool_care, afterschool_care_program)
    values (${kealoha.id}, 'Maile', 'Kahananui', '2018-09-02'::date, 2, true, 'A+')
    returning id`;

  // Two children, two classes, and one of them in both: the exact shape the
  // sentence describes.
  await enroll(sql, { parentId: kealoha.id, childId: nalu.id, classId: sellable[0].id, priceCents: sellable[0].price_cents, key: "k1" });
  await enroll(sql, { parentId: kealoha.id, childId: nalu.id, classId: sellable[1].id, priceCents: sellable[1].price_cents, key: "k2" });
  await enroll(sql, { parentId: kealoha.id, childId: maile.id, classId: sellable[0].id, priceCents: sellable[0].price_cents, key: "k3" });

  out["A parent with two children, one of them in two classes"] =
    `${kealoha.full_name} — Nalu is in ${sellable[0].title} and ${sellable[1].title}`;

  // -------------------------------------------------------------------------
  // "Kids sometimes join mid-semester." Recorded as the session they start
  // from, which is what makes a pro rata conversation possible at all.
  // -------------------------------------------------------------------------
  const [wong] = await sql<{ id: string; full_name: string }[]>`
    insert into parents (email, full_name, phone)
    values ('gordon.wong@yahoo.com', 'Gordon Wong', '808-291-7734')
    on conflict (email) do update set full_name = excluded.full_name
    returning id, full_name`;
  const [ekolu] = await sql<{ id: string }[]>`
    insert into children (parent_id, first_name, last_name, date_of_birth, grade)
    values (${wong.id}, 'Ekolu', 'Wong', '2015-11-20'::date, 5)
    returning id`;

  const [week4] = await sql<{ id: string }[]>`
    select id from sessions where class_offering_id = ${sellable[2].id}
     order by session_date asc offset 3 limit 1`;

  await enroll(sql, {
    parentId: wong.id, childId: ekolu.id, classId: sellable[2].id,
    priceCents: sellable[2].price_cents, key: "midterm",
    fromSessionId: week4?.id ?? null, daysAgo: 2,
  });
  out["A child who joined mid semester"] = `Ekolu Wong — ${sellable[2].title}, from week 4`;

  // -------------------------------------------------------------------------
  // "or drop." The other half of the same sentence, and deliberately not a
  // refund: the seat comes back, the money does not move.
  // -------------------------------------------------------------------------
  const [silva] = await sql<{ id: string; full_name: string }[]>`
    insert into parents (email, full_name, phone)
    values ('rachel.silva@gmail.com', 'Rachel Silva', '808-556-2210')
    on conflict (email) do update set full_name = excluded.full_name
    returning id, full_name`;
  const [hina] = await sql<{ id: string }[]>`
    insert into children (parent_id, first_name, last_name, date_of_birth, grade)
    values (${silva.id}, 'Hina', 'Silva', '2016-02-14'::date, 4)
    returning id`;

  const dropped = await enroll(sql, {
    parentId: silva.id, childId: hina.id, classId: sellable[2].id,
    priceCents: sellable[2].price_cents, key: "dropped", daysAgo: 30,
  });

  const [week6] = await sql<{ id: string }[]>`
    select id from sessions where class_offering_id = ${sellable[2].id}
     order by session_date asc offset 5 limit 1`;

  await sql`
    update enrollments
       set status = 'dropped', dropped_at = now() - interval '9 days',
           dropped_reason_code = 'schedule_conflict',
           dropped_note = 'Mum rang: swim squad moved to the same afternoon.',
           dropped_by = ${staff.email},
           dropped_from_session_id = ${week6?.id ?? null}
     where id = ${dropped.enrollmentId}`;
  // The seat goes back the moment they drop, exactly as the action does.
  await sql`update class_offerings set seats_taken = seats_taken - 1 where id = ${sellable[2].id}`;
  await sql`insert into enrollment_events (enrollment_id, event, payload)
            values (${dropped.enrollmentId}, 'dropped',
                    ${JSON.stringify({ by: staff.email, reason: "schedule_conflict" })}::jsonb)`;
  out["A child who dropped, with no refund"] = "Hina Silva — stopped at week 6, seat returned";

  // -------------------------------------------------------------------------
  // "Parents can see their registrations and request a cancellation." One
  // waiting on a decision, so the queue is not empty during a demo.
  // -------------------------------------------------------------------------
  const [tanaka] = await sql<{ id: string; full_name: string }[]>`
    insert into parents (email, full_name, phone)
    values ('marissa.tanaka@icloud.com', 'Marissa Tanaka', '808-604-9912')
    on conflict (email) do update set full_name = excluded.full_name
    returning id, full_name`;
  const [kaimana] = await sql<{ id: string }[]>`
    insert into children (parent_id, first_name, last_name, date_of_birth, grade)
    values (${tanaka.id}, 'Kaimana', 'Tanaka', '2017-06-30'::date, 3)
    returning id`;

  const pending = await enroll(sql, {
    parentId: tanaka.id, childId: kaimana.id, classId: sellable[3].id,
    priceCents: sellable[3].price_cents, key: "pending", daysAgo: 12,
  });
  await sql`
    update enrollments
       set status = 'cancellation_requested',
           cancellation_requested_at = now() - interval '1 day',
           cancellation_reason_code = 'schedule_conflict',
           cancellation_reason = 'The time no longer works for us',
           cancellation_note = 'We have moved to Kailua and cannot make the 3pm start.'
     where id = ${pending.enrollmentId}`;
  await sql`insert into enrollment_events (enrollment_id, event, payload)
            values (${pending.enrollmentId}, 'cancellation_requested',
                    ${JSON.stringify({ reason: "schedule_conflict" })}::jsonb)`;
  out["A cancellation waiting on a decision"] =
    `Kaimana Tanaka — ${sellable[3].title}, asked yesterday`;

  // -------------------------------------------------------------------------
  // "Sessions occasionally get canceled for holidays or rescheduled." One of
  // each, on the class the demo will open.
  // -------------------------------------------------------------------------
  const demoClass = sellable[0];

  const [holiday] = await sql<{ id: string; session_date: string }[]>`
    select id, to_char(session_date, 'YYYY-MM-DD') as session_date
      from sessions
     where class_offering_id = ${demoClass.id} and status = 'scheduled'
       and starts_at > now()
     order by session_date asc offset 1 limit 1`;

  /*
   * Both of these go through the real engine rather than writing rows by hand.
   *
   * That is the whole reason seeded data is worth showing at all: a cancellation
   * and a move each produce an audit row, a preserved history, a replacement
   * session and a queued email, and reproducing any of that in a seed would be
   * demonstrating something the product does not actually do.
   *
   * Writing it by hand also failed twice here, on the unique index for
   * (class, date) and then on (class, seq). Both are constraints the engine
   * already knows how to work with, which is the argument for calling it.
   */
  if (holiday) {
    await sql.begin(async (tx) => {
      await cancelSessions(tx as never, {
        sessionIds: [holiday.id],
        reasonCode: "holiday",
        note: "Statehood Day, campus closed",
        // Nobody is enrolled at seed time and a demo does not want a mailbox
        // full of seeded notices.
        notify: false,
        actorId: staff.id,
      });
    });
    out["A session cancelled for a holiday"] = `${demoClass.title} — ${holiday.session_date}`;
  }

  const [moved] = await sql<{ id: string; session_date: string }[]>`
    select id, to_char(session_date, 'YYYY-MM-DD') as session_date
      from sessions
     where class_offering_id = ${demoClass.id} and status = 'scheduled'
       and starts_at > now()
     order by session_date asc offset 2 limit 1`;

  if (moved) {
    // The next day, not the next week. A week later is the following session's
    // own date, and the engine correctly refuses to run one class twice on an
    // afternoon. "The hall was booked so we ran it on the Thursday" is also the
    // truer story.
    const next = new Date(`${moved.session_date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const newDate = next.toISOString().slice(0, 10);

    await sql.begin(async (tx) => {
      await moveSession(tx as never, {
        sessionId: moved.id,
        newDate,
        reasonCode: "facility",
        note: "Hall booked for the school production",
        notify: false,
        actorId: staff.id,
      });
    });
    out["A session moved to another day"] =
      `${demoClass.title} — ${moved.session_date} moved to ${newDate}`;
  }

  // -------------------------------------------------------------------------
  // "50 parents hit a class with 12 seats." A class one seat from full, so the
  // oversell story has something real to point at.
  // -------------------------------------------------------------------------
  const [tight] = await sql<
    {
      id: string;
      title: string;
      capacity: number;
      seats_taken: number;
      price_cents: number | null;
    }[]
  >`
    select c.id, c.title, c.capacity, c.seats_taken, c.price_cents
      from class_offerings c
     where c.status = 'published' and c.registration_mode = 'keiki_coders'
       and c.capacity between 12 and 20
     order by c.capacity - c.seats_taken asc
     limit 1`;

  if (tight) {
    const free = tight.capacity - tight.seats_taken;
    if (free > 1) {
      /*
       * Filled with paid enrollments, not seat holds.
       *
       * The first version used holds, on the argument that a hold is what a
       * parent halfway through checkout actually creates. That argument was
       * wrong twice over.
       *
       * It was wrong about the product: the sweeper releases an expired hold
       * once a minute, and since that sweeper moved into the database it runs
       * on the deployment too, so twelve minutes after seeding it correctly ate
       * the entire demonstration and the class went back to five of sixteen.
       * The state could not survive its own system, which is a good sign the
       * state was a lie.
       *
       * And it was wrong about the story. A class one seat from full is fifteen
       * families who paid, over weeks. It is not fifteen people simultaneously
       * stuck on a card form. Enrollments are what that class really looks
       * like, they keep `enrolled + held = seats_taken` true just as well, and
       * nothing reclaims them.
       */
      const fillers = await sql<{ id: string; parent_id: string }[]>`
        select ch.id, ch.parent_id
          from children ch
         where not exists (
           select 1 from enrollments e
            where e.child_id = ch.id and e.class_offering_id = ${tight.id})
         order by ch.created_at asc
         limit ${free - 1}`;

      for (let i = 0; i < fillers.length; i++) {
        await enroll(sql, {
          parentId: fillers[i].parent_id,
          childId: fillers[i].id,
          classId: tight.id,
          priceCents: tight.price_cents ?? 0,
          key: `tight:${i}`,
          daysAgo: 30 - i,
        });
      }
    }
    out["A class one seat from full"] =
      `${tight.title} — ${tight.capacity} seats, for the oversell story`;
  }

  /*
   * Every address this file invented, written down.
   *
   * Kept as one list at the end rather than an insert beside each parent,
   * because the property that matters is "all of them, without exception" and
   * that is easier to check in one place than to trust across four. If a future
   * scenario adds a fifth family, the test that counts parents against
   * demo_addresses is what will catch the omission.
   *
   * See 20260906120000_demo_addresses.sql: mail to these is redirected, and
   * anybody not on this list typed their address in themselves and gets their
   * own mail.
   */
  const invented = await sql<{ email: string; full_name: string }[]>`
    select email, full_name from parents
     where email in ('noelani.kahananui@gmail.com', 'gordon.wong@yahoo.com',
                     'rachel.silva@gmail.com', 'marissa.tanaka@icloud.com')`;
  for (const p of invented) {
    await sql`
      insert into demo_addresses (address, note)
      values (${p.email.toLowerCase()}, ${`seeded scenario: ${p.full_name}`})
      on conflict (address) do nothing`;
  }

  return out;
}
