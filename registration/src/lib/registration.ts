import { z } from "zod";
import { sql } from "./db";

/**
 * Phase one of a registration: everything that happens BEFORE the parent is sent
 * to Stripe.
 *
 * The order of operations here is the whole answer to their question "what gets
 * created and in what order". It runs in a single transaction, and it takes the
 * seats before payment rather than after. That one decision is what turns
 * "payment succeeded but the write failed" from a data-loss incident into a
 * retryable no-op: by the time money moves, the seats are already ours.
 */

export const RegistrationInput = z.object({
  // Minted by the form when it opens, not by the server. A double-clicked
  // submit, or a mobile browser silently retrying, arrives with the same key.
  idempotencyKey: z.string().min(8).max(100),
  parent: z.object({
    email: z.string().email().max(200),
    fullName: z.string().min(1).max(200),
    phone: z.string().max(50).optional().nullable(),
  }),
  registrations: z
    .array(
      z.object({
        classOfferingId: z.string().uuid(),
        child: z.object({
          firstName: z.string().min(1).max(100),
          lastName: z.string().min(1).max(100),
          dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          notes: z.string().max(1000).optional().nullable(),
        }),
      }),
    )
    .min(1)
    .max(10),
});

export type RegistrationInput = z.infer<typeof RegistrationInput>;

export type RegistrationResult =
  | { ok: true; orderId: string; amountCents: number; reused: boolean }
  | { ok: false; reason: "class_full"; fullClasses: { id: string; title: string }[] }
  | { ok: false; reason: "already_enrolled"; detail: string }
  | { ok: false; reason: "class_not_available" };

const HOLD_MINUTES = 15;

export async function createPendingOrder(
  input: RegistrationInput,
): Promise<RegistrationResult> {
  return sql.begin(async (tx) => {
    // 1. Resolve the parent on normalised email.
    //
    // Identity is the email address, stored as citext so case never splits a
    // family in two. This is an atomic upsert rather than select-then-insert,
    // so two simultaneous first-time registrations cannot both create a row.
    //
    // Deliberately NOT fuzzy matching on name or phone: a false merge joins two
    // families' records, and with children's data that is an incident, not a
    // bug. A false split is only a support ticket. Take the cheap error.
    const [parent] = await tx<{ id: string }[]>`
      insert into parents (email, full_name, phone)
      values (${input.parent.email.trim().toLowerCase()}, ${input.parent.fullName.trim()},
              ${input.parent.phone ?? null})
      on conflict (email) do update
        set full_name = excluded.full_name,
            phone = coalesce(excluded.phone, parents.phone)
      returning id`;

    // 2. Idempotency. If this exact submission has been seen, hand back the
    //    same order instead of creating a second one and charging twice.
    const [existing] = await tx<{ id: string; amount_cents: number }[]>`
      select id, amount_cents from orders
       where parent_id = ${parent.id} and idempotency_key = ${input.idempotencyKey}`;
    if (existing) {
      return {
        ok: true as const,
        orderId: existing.id,
        amountCents: existing.amount_cents,
        reused: true,
      };
    }

    // 3. Load the classes being registered for, and lock nothing yet.
    const classIds = [...new Set(input.registrations.map((r) => r.classOfferingId))];
    const classes = await tx<
      {
        id: string;
        title: string;
        price_cents: number;
        stripe_price_id: string | null;
        status: string;
        registration_opens_at: Date;
      }[]
    >`select id, title, price_cents, stripe_price_id, status, registration_opens_at
        from class_offerings where id = any(${classIds})`;

    if (classes.length !== classIds.length) return { ok: false as const, reason: "class_not_available" as const };
    for (const c of classes) {
      if (c.status !== "published" || c.registration_opens_at > new Date()) {
        return { ok: false as const, reason: "class_not_available" as const };
      }
    }
    const byId = new Map(classes.map((c) => [c.id, c]));

    // 4. Resolve each child. The natural key is scoped to the parent, so two
    //    families with a "Noa Kim" never collide, and the same child submitted
    //    twice resolves to one row rather than two.
    const childIds: string[] = [];
    for (const r of input.registrations) {
      const [child] = await tx<{ id: string }[]>`
        insert into children (parent_id, first_name, last_name, date_of_birth, notes)
        values (${parent.id}, ${r.child.firstName.trim()}, ${r.child.lastName.trim()},
                ${r.child.dateOfBirth}, ${r.child.notes ?? null})
        on conflict (parent_id, lower(first_name), lower(last_name), date_of_birth)
        do update set notes = coalesce(excluded.notes, children.notes)
        returning id`;
      childIds.push(child.id);
    }

    // 5. Reject a child already holding a live place in the same class before
    //    taking any seats. The partial unique index would catch it anyway; this
    //    just produces a readable message instead of a constraint violation.
    for (let i = 0; i < input.registrations.length; i++) {
      const [clash] = await tx<{ id: string }[]>`
        select id from enrollments
         where child_id = ${childIds[i]}
           and class_offering_id = ${input.registrations[i].classOfferingId}
           and status in ('active','cancellation_requested')`;
      if (clash) {
        const cls = byId.get(input.registrations[i].classOfferingId)!;
        return {
          ok: false as const,
          reason: "already_enrolled" as const,
          detail: `${input.registrations[i].child.firstName} is already enrolled in ${cls.title}.`,
        };
      }
    }

    // 6. Create the order and its items.
    const amountCents = input.registrations.reduce(
      (sum, r) => sum + byId.get(r.classOfferingId)!.price_cents,
      0,
    );
    const [order] = await tx<{ id: string }[]>`
      insert into orders (parent_id, idempotency_key, status, amount_cents)
      values (${parent.id}, ${input.idempotencyKey}, 'pending', ${amountCents})
      returning id`;

    // 7. Take a seat for every item, all or nothing.
    //
    //    take_seat() is a single atomic UPDATE ... WHERE seats_taken < capacity.
    //    No read-then-write, so fifty simultaneous registrations against twelve
    //    seats produce exactly twelve winners. If any one fails, the whole
    //    transaction rolls back: the alternative, enrolling one child and
    //    charging for one, is a refund conversation and a confused parent on
    //    the first day of term.
    const full: { id: string; title: string }[] = [];
    for (let i = 0; i < input.registrations.length; i++) {
      const r = input.registrations[i];
      const cls = byId.get(r.classOfferingId)!;

      const [firstSession] = await tx<{ id: string }[]>`
        select id from sessions
         where class_offering_id = ${r.classOfferingId} and status = 'scheduled'
           and starts_at >= now()
         order by starts_at asc limit 1`;

      const [item] = await tx<{ id: string }[]>`
        insert into order_items
          (order_id, class_offering_id, child_id, unit_price_cents, stripe_price_id,
           starts_from_session_id)
        values (${order.id}, ${r.classOfferingId}, ${childIds[i]}, ${cls.price_cents},
                ${cls.stripe_price_id}, ${firstSession?.id ?? null})
        returning id`;

      const [{ take_seat: got }] = await tx<{ take_seat: boolean }[]>`
        select take_seat(${r.classOfferingId})`;
      if (!got) {
        full.push({ id: cls.id, title: cls.title });
        continue;
      }

      await tx`insert into seat_holds (order_item_id, class_offering_id, expires_at)
               values (${item.id}, ${r.classOfferingId},
                       now() + interval '${sql.unsafe(String(HOLD_MINUTES))} minutes')`;
    }

    if (full.length > 0) {
      // Rolling back returns every seat taken in this transaction, because the
      // counter increment is part of it.
      throw new ClassFullError(full);
    }

    await tx`insert into enrollment_events (order_id, event, payload)
             values (${order.id}, 'order_created',
                     ${JSON.stringify({ items: input.registrations.length, amountCents })}::jsonb)`;

    return { ok: true as const, orderId: order.id, amountCents, reused: false };
  }).catch((e: unknown) => {
    if (e instanceof ClassFullError) {
      return { ok: false as const, reason: "class_full" as const, fullClasses: e.fullClasses };
    }
    throw e;
  });
}

class ClassFullError extends Error {
  constructor(public fullClasses: { id: string; title: string }[]) {
    super("class_full");
  }
}
