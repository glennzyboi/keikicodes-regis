import { z } from "zod";
import { sql } from "./db";
import { HOLD_MINUTES } from "./holds";
import { POLICY_VERSION } from "./policies";

/**
 * Phase one of a registration: everything that happens BEFORE the parent is sent
 * to Stripe.
 *
 * The order of operations here is the whole answer to their question "what gets
 * created and in what order". It runs in a single transaction, and it takes the
 * seats before payment rather than after. That one decision is what turns
 * "payment succeeded but the write failed" from a data-loss incident into a
 * retryable no-op: by the time money moves, the seats are already ours.
 *
 * It also collects everything their own form collects, because anything we drop
 * is something their office loses on the day. Grade, head shot, after school
 * care, the attestation that the child attends that campus, a second guardian,
 * and a dated, versioned consent record rather than a ticked box.
 */

const Grade = z.number().int().min(0).max(12);

const ChildInput = z.object({
  // A returning family picks a child they already have on file. Their form asks
  // for every detail again, every term, for every child.
  childId: z.string().uuid().optional(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  grade: Grade,
  notes: z.string().max(1000).optional().nullable(),
  // Checked against the signed in parent below, not trusted from here. The
  // shape check is a first gate: an object key is "<parent id>/<file>", so
  // anything with a traversal segment or a scheme in it is refused outright.
  photoPath: z
    .string()
    .max(400)
    .regex(
      /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,200}$/,
      "That is not a photo we stored",
    )
    .optional()
    .nullable(),
  inAfterschoolCare: z.boolean().optional().default(false),
  afterschoolCareProgram: z.string().max(60).optional().nullable(),
});

export const RegistrationInput = z.object({
  // Minted by the form when it opens, not by the server. A double-clicked
  // submit, or a mobile browser silently retrying, arrives with the same key.
  idempotencyKey: z.string().min(8).max(100),
  // Deliberately no parent field. Identity comes from the signed in session,
  // never from the request body, so nobody can register children against
  // somebody else's account by editing a payload.
  registrations: z
    .array(
      z.object({
        classOfferingId: z.string().uuid(),
        child: ChildInput,
        // Their form makes this a required tick before payment. It is a claim
        // about one child at one campus, so it belongs on the purchase.
        attendsSchoolConfirmed: z.boolean(),
      }),
    )
    .min(1)
    .max(10),

  // Recorded against the family, with the version, at the moment of agreeing.
  agreedToPolicies: z.literal(true),
  policyVersion: z.string().min(1).max(40).optional(),

  marketingOptIn: z.boolean().optional().default(false),
  heardAboutUs: z.string().max(120).optional().nullable(),
  parentPhone: z.string().max(40).optional().nullable(),

  guardian: z
    .object({
      fullName: z.string().min(1).max(120),
      email: z.string().email().max(200).optional().nullable(),
      phone: z.string().max(40).optional().nullable(),
      relation: z.string().max(60).optional().nullable(),
    })
    .optional()
    .nullable(),
});

export type RegistrationInput = z.infer<typeof RegistrationInput>;

export type RegistrationResult =
  | { ok: true; orderId: string; amountCents: number; reused: boolean }
  | { ok: false; reason: "class_full"; fullClasses: { id: string; title: string }[] }
  | { ok: false; reason: "already_enrolled"; detail: string }
  | { ok: false; reason: "schedule_conflict"; detail: string }
  | { ok: false; reason: "grade_not_eligible"; detail: string }
  | { ok: false; reason: "registered_elsewhere"; detail: string }
  | { ok: false; reason: "photo_not_yours"; detail: string }
  | { ok: false; reason: "class_not_available" };

type OfferingRow = {
  id: string;
  title: string;
  price_cents: number | null;
  stripe_price_id: string | null;
  status: string;
  registration_opens_at: Date;
  registration_closes_at: Date | null;
  registration_mode: string;
  grade_min: number | null;
  grade_max: number | null;
  school_name: string;
};

const gradeLabel = (g: number) => (g === 0 ? "kindergarten" : `grade ${g}`);

function rangeLabel(min: number | null, max: number | null): string {
  if (min === null && max === null) return "any grade";
  if (min !== null && max !== null && min === max) return gradeLabel(min);
  const lo = min === null ? "any" : min === 0 ? "K" : String(min);
  const hi = max === null ? "any" : max === 0 ? "K" : String(max);
  return `grades ${lo} to ${hi}`;
}

export async function createPendingOrder(
  parentId: string,
  input: RegistrationInput,
): Promise<RegistrationResult> {
  return sql
    .begin(async (tx) => {
      // 1. The parent is already resolved.
      //
      // They signed in, so identity is settled before this function is called
      // and there is no matching to do. That removes a whole class of question:
      // no fuzzy matching on name or phone, no deciding whether two spellings
      // are the same family. A false merge joins two families' records, and
      // with children's data that is an incident rather than a bug.
      //
      // The row is locked for the duration. Two submissions from the same
      // account at the same moment serialise here, which is what makes the
      // idempotency check below safe against a genuine double click.
      const [parent] = await tx<{ id: string }[]>`
        select id from parents where id = ${parentId} for update`;

      if (!parent) return { ok: false as const, reason: "class_not_available" as const };

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

      // 3. Load the classes being registered for.
      const classIds = [...new Set(input.registrations.map((r) => r.classOfferingId))];
      const classes = await tx<OfferingRow[]>`
        select c.id, c.title, c.price_cents, c.stripe_price_id, c.status,
               c.registration_opens_at, c.registration_closes_at, c.registration_mode,
               c.grade_min, c.grade_max, s.name as school_name
          from class_offerings c join schools s on s.id = c.school_id
         where c.id = any(${classIds})`;

      if (classes.length !== classIds.length) {
        return { ok: false as const, reason: "class_not_available" as const };
      }

      const now = new Date();
      for (const c of classes) {
        if (c.status !== "published") return { ok: false as const, reason: "class_not_available" as const };
        if (c.registration_opens_at > now) return { ok: false as const, reason: "class_not_available" as const };
        if (c.registration_closes_at && c.registration_closes_at < now) {
          return { ok: false as const, reason: "class_not_available" as const };
        }

        // 3b. Over half their catalogue is enrolled through the school's own
        //     office, not through us. Those classes are listed so families can
        //     find them, and taking money for one would be taking money for
        //     something we do not control. Checked here rather than only in the
        //     form, because the form is not the boundary.
        if (c.registration_mode !== "keiki_coders") {
          return {
            ok: false as const,
            reason: "registered_elsewhere" as const,
            detail: `${c.title} is enrolled through ${c.school_name} directly, not through Keiki Coders.`,
          };
        }
        if (c.price_cents === null) {
          return { ok: false as const, reason: "class_not_available" as const };
        }
      }
      const byId = new Map(classes.map((c) => [c.id, c]));

      // 3c. A photograph belongs to the family that uploaded it.
      //
      //     The object key is "<parent id>/<file>", and storage enforces that
      //     on write. Nothing enforced it here, so a parent could put another
      //     family's key in the payload and their child's record would point at
      //     a photograph of somebody else's child, which staff would then open.
      //     One string comparison, and the whole class of problem is gone.
      for (const r of input.registrations) {
        const path = r.child.photoPath;
        if (path && !path.startsWith(`${parent.id}/`)) {
          // Its own reason rather than the generic one. A refusal that names
          // the wrong cause costs somebody an hour: this fired once during a
          // manual run and reported that the class was unavailable, which sent
          // the investigation straight at the catalogue.
          return {
            ok: false as const,
            reason: "photo_not_yours" as const,
            detail:
              "That photograph is not one you uploaded. Choose the photo again and resubmit.",
          };
        }
      }

      // 4. Resolve each child.
      //
      //    An id means a child already on file, and it is checked against this
      //    parent rather than trusted: an id in a request body is an assertion,
      //    not a fact. Otherwise the natural key is scoped to the parent, so two
      //    families with a "Noa Kim" never collide and the same child submitted
      //    twice resolves to one row rather than two.
      const childIds: string[] = [];
      for (const r of input.registrations) {
        const c = r.child;
        if (c.childId) {
          const [owned] = await tx<{ id: string }[]>`
            select id from children where id = ${c.childId} and parent_id = ${parent.id}`;
          if (!owned) return { ok: false as const, reason: "class_not_available" as const };
          await tx`
            update children
               set first_name = ${c.firstName.trim()},
                   last_name  = ${c.lastName.trim()},
                   date_of_birth = ${c.dateOfBirth}::date,
                   grade = ${c.grade},
                   notes = coalesce(${c.notes ?? null}, notes),
                   photo_path = coalesce(${c.photoPath ?? null}, photo_path),
                   in_afterschool_care = ${c.inAfterschoolCare ?? false},
                   afterschool_care_program = ${c.afterschoolCareProgram ?? null}
             where id = ${owned.id}`;
          childIds.push(owned.id);
          continue;
        }

        const [child] = await tx<{ id: string }[]>`
          insert into children (parent_id, first_name, last_name, date_of_birth, grade,
                                notes, photo_path, in_afterschool_care, afterschool_care_program)
          values (${parent.id}, ${c.firstName.trim()}, ${c.lastName.trim()},
                  ${c.dateOfBirth}::date, ${c.grade}, ${c.notes ?? null},
                  ${c.photoPath ?? null}, ${c.inAfterschoolCare ?? false},
                  ${c.afterschoolCareProgram ?? null})
          on conflict (parent_id, lower(first_name), lower(last_name), date_of_birth)
          do update set notes      = coalesce(excluded.notes, children.notes),
                        grade      = excluded.grade,
                        photo_path = coalesce(excluded.photo_path, children.photo_path),
                        in_afterschool_care = excluded.in_afterschool_care,
                        afterschool_care_program = excluded.afterschool_care_program
          returning id`;
        childIds.push(child.id);
      }

      // 5. Grade eligibility.
      //
      //    Their classes are sold by grade and their form does not check, so a
      //    parent can put a first grader into a class for grades 6 to 8 and
      //    nobody finds out until the child turns up. The form filters; this is
      //    what makes the filter true.
      for (let i = 0; i < input.registrations.length; i++) {
        const r = input.registrations[i];
        const cls = byId.get(r.classOfferingId)!;
        const g = r.child.grade;
        if (
          (cls.grade_min !== null && g < cls.grade_min) ||
          (cls.grade_max !== null && g > cls.grade_max)
        ) {
          return {
            ok: false as const,
            reason: "grade_not_eligible" as const,
            detail: `${cls.title} is for ${rangeLabel(cls.grade_min, cls.grade_max)}, and ${r.child.firstName} is in ${gradeLabel(g)}.`,
          };
        }
      }

      // 6. Reject a child already holding a live place in the same class before
      //    taking any seats. The partial unique index would catch it anyway;
      //    this just produces a readable message instead of a constraint error.
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

      // 7. A child cannot be in two places at once.
      //
      //    Checked against places they already hold, and against the other
      //    classes in this same submission. The second half matters: nothing has
      //    been written yet, so the database cannot see the clash between two
      //    rows that are both about to be inserted.
      //
      //    Named rather than generic. "Kaimana already has Roblox Studio Lab at
      //    that time" is actionable; "schedule conflict" makes a parent hunt.
      for (let i = 0; i < input.registrations.length; i++) {
        const r = input.registrations[i];

        const held = await tx<{ title: string; school: string }[]>`
          select title, school from clashing_enrollments(${childIds[i]}, ${r.classOfferingId})`;

        if (held.length > 0) {
          return {
            ok: false as const,
            reason: "schedule_conflict" as const,
            detail: `${r.child.firstName} already has ${held[0].title} at that time. A child cannot be in two classes at once.`,
          };
        }

        for (let j = 0; j < i; j++) {
          if (childIds[j] !== childIds[i]) continue;
          const other = input.registrations[j];
          const [{ classes_clash: clashes }] = await tx<{ classes_clash: boolean }[]>`
            select classes_clash(${r.classOfferingId}, ${other.classOfferingId})`;
          if (clashes) {
            const a = byId.get(r.classOfferingId)!;
            const b = byId.get(other.classOfferingId)!;
            return {
              ok: false as const,
              reason: "schedule_conflict" as const,
              detail: `${a.title} and ${b.title} run at the same time, so ${r.child.firstName} cannot do both.`,
            };
          }
        }
      }

      // 8. The family record: phone, how they heard about us, marketing choice,
      //    the second guardian, and the consent.
      await tx`
        update parents
           set phone            = coalesce(${input.parentPhone ?? null}, phone),
               heard_about_us   = coalesce(${input.heardAboutUs ?? null}, heard_about_us),
               marketing_opt_in = ${input.marketingOptIn ?? false}
         where id = ${parent.id}`;

      if (input.guardian) {
        const g = input.guardian;
        // Same person named twice is the same guardian, not two.
        const [dupe] = await tx<{ id: string }[]>`
          select id from guardians
           where parent_id = ${parent.id} and lower(full_name) = lower(${g.fullName})`;
        if (dupe) {
          await tx`update guardians
                      set email = coalesce(${g.email ?? null}, email),
                          phone = coalesce(${g.phone ?? null}, phone),
                          relation = coalesce(${g.relation ?? null}, relation)
                    where id = ${dupe.id}`;
        } else {
          await tx`insert into guardians (parent_id, full_name, email, phone, relation)
                   values (${parent.id}, ${g.fullName.trim()}, ${g.email ?? null},
                           ${g.phone ?? null}, ${g.relation ?? null})`;
        }
      }

      // 9. Create the order and its items.
      const amountCents = input.registrations.reduce(
        (sum, r) => sum + (byId.get(r.classOfferingId)!.price_cents ?? 0),
        0,
      );
      const [order] = await tx<{ id: string }[]>`
        insert into orders (parent_id, idempotency_key, status, amount_cents)
        values (${parent.id}, ${input.idempotencyKey}, 'pending', ${amountCents})
        returning id`;

      // The consent is written inside the same transaction as the order it was
      // given for. If the order rolls back, so does the record of agreeing to
      // something that never happened.
      await tx`
        insert into consents (parent_id, kind, policy_version, order_id)
        values (${parent.id}, 'participation_policies',
                ${input.policyVersion ?? POLICY_VERSION}, ${order.id})
        on conflict (parent_id, kind, policy_version) do nothing`;
      if (input.marketingOptIn) {
        await tx`
          insert into consents (parent_id, kind, policy_version, order_id)
          values (${parent.id}, 'marketing', ${input.policyVersion ?? POLICY_VERSION}, ${order.id})
          on conflict (parent_id, kind, policy_version) do nothing`;
      }

      // 10. Take a seat for every item, all or nothing.
      //
      //     take_seat() is a single atomic UPDATE ... WHERE seats_taken <
      //     capacity. No read-then-write, so fifty simultaneous registrations
      //     against twelve seats produce exactly twelve winners. If any one
      //     fails, the whole transaction rolls back: the alternative, enrolling
      //     one child and charging for one, is a refund conversation and a
      //     confused parent on the first day of term.
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
             starts_from_session_id, attends_school_confirmed)
          values (${order.id}, ${r.classOfferingId}, ${childIds[i]}, ${cls.price_cents},
                  ${cls.stripe_price_id}, ${firstSession?.id ?? null},
                  ${r.attendsSchoolConfirmed === true})
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
        // Rolling back returns every seat taken in this transaction, because
        // the counter increment is part of it.
        throw new ClassFullError(full);
      }

      await tx`insert into enrollment_events (order_id, event, payload)
               values (${order.id}, 'order_created',
                       ${JSON.stringify({ items: input.registrations.length, amountCents })}::jsonb)`;

      return { ok: true as const, orderId: order.id, amountCents, reused: false };
    })
    .catch((e: unknown) => {
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
