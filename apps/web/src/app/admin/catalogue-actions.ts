"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@keiki/core/db";
import { stripe } from "@keiki/core/stripe";
import { enqueue } from "@keiki/core/notify";
import {
  parseForm,
  SchoolForm,
  ProgramForm,
  TermForm,
  OfferingForm,
  OfferingIdForm,
  ImportForm,
} from "@keiki/core/forms";
import { importCatalogue, LIVE_SOURCE } from "@keiki/core/catalogue/import";
import { currentStaff, supabaseServer } from "@/lib/staff-auth";

/**
 * The catalogue, owned by the office.
 *
 * This is the gap the whole build exists to close. Today their programmes live
 * in Airtable, which is not a great application but is a genuinely good
 * spreadsheet: someone in the office can add a class, change a price or close
 * registration in seconds, without asking anybody. Until now this system could
 * not do any of that. The catalogue lived in a seed script, and adding a class
 * meant editing TypeScript and re-running something that deleted every family.
 *
 * Replacing a tool that lets people work with one that does not is how a
 * migration gets quietly abandoned, so this had to be at least as fast as what
 * they have, and safer.
 *
 * Safer is the interesting half. A spreadsheet will happily let you set a
 * capacity of 8 on a class with 14 children in it, change a price after people
 * have paid, or move a Tuesday class to a Thursday without telling the
 * fourteen families who arranged their week around it. Every one of those is
 * refused or surfaced here, with the number of affected families named.
 */

type Result = { ok: true; message: string } | { ok: false; error: string };

/** The columns that decide whether a save needs a warning or a refusal. */
type Existing = {
  weekday: number;
  start_time: string;
  end_time: string;
  first_session_date: Date;
  last_session_date: Date;
  price_cents: number | null;
  seats_taken: number;
  title: string;
};

async function requireStaff() {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");
  return staff;
}

function refresh() {
  revalidatePath("/admin/setup", "layout");
  revalidatePath("/admin/classes", "layout");
  revalidatePath("/admin/schedule");
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Schools
// ---------------------------------------------------------------------------

export async function saveSchool(_prev: unknown, formData: FormData): Promise<Result> {
  await requireStaff();
  const parsed = parseForm(SchoolForm, formData);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const f = parsed.data;

  const slug = slugify(f.name);

  try {
    if (f.schoolId) {
      // `logo_url` is deliberately absent. The upload action is the only writer
      // of that column now; leaving it here meant that saving any other field
      // on this form wrote the picture back as null and wiped it.
      await sql`
        update schools
           set name = ${f.name}, slug = ${slug}, kind = ${f.kind}, area = ${f.area},
               timezone = ${f.timezone},
               external_registration_url = ${f.externalRegistrationUrl},
               active = ${f.active}
         where id = ${f.schoolId}`;
    } else {
      await sql`
        insert into schools (name, slug, kind, area, timezone,
                             external_registration_url, active)
        values (${f.name}, ${slug}, ${f.kind}, ${f.area}, ${f.timezone},
                ${f.externalRegistrationUrl}, ${f.active})`;
    }
  } catch (err) {
    return { ok: false, error: uniqueMessage(err, `A campus called ${f.name} already exists.`) };
  }

  refresh();
  return { ok: true, message: `${f.name} saved.` };
}

export async function deleteSchool(_prev: unknown, formData: FormData): Promise<Result> {
  await requireStaff();
  const id = String(formData.get("schoolId") ?? "");

  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from class_offerings where school_id = ${id}`;
  if (n > 0) {
    // Deleting the campus would orphan its classes and everybody in them. The
    // useful action is almost always "stop showing it", which is what active is.
    return {
      ok: false,
      error: `${n} class${n === 1 ? "" : "es"} still run at this campus. Untick "listed" to hide it instead, or move the classes first.`,
    };
  }

  await sql`delete from schools where id = ${id}`;
  refresh();
  return { ok: true, message: "Campus removed." };
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

export async function saveProgram(_prev: unknown, formData: FormData): Promise<Result> {
  await requireStaff();
  const parsed = parseForm(ProgramForm, formData);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const f = parsed.data;
  const slug = slugify(f.name);

  try {
    if (f.programId) {
      await sql`
        update programs
           set name = ${f.name}, slug = ${slug}, track = ${f.track}, subject = ${f.subject},
               description = ${f.description}, active = ${f.active}
         where id = ${f.programId}`;
    } else {
      await sql`
        insert into programs (name, slug, track, subject, description, active)
        values (${f.name}, ${slug}, ${f.track}, ${f.subject}, ${f.description},
                ${f.active})`;
    }
  } catch (err) {
    return { ok: false, error: uniqueMessage(err, `A program called ${f.name} already exists.`) };
  }

  refresh();
  return { ok: true, message: `${f.name} saved.` };
}

export async function deleteProgram(_prev: unknown, formData: FormData): Promise<Result> {
  await requireStaff();
  const id = String(formData.get("programId") ?? "");

  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from class_offerings where program_id = ${id}`;
  if (n > 0) {
    return {
      ok: false,
      error: `${n} class${n === 1 ? "" : "es"} use this program. Untick "offered" to retire it instead.`,
    };
  }

  await sql`delete from programs where id = ${id}`;
  refresh();
  return { ok: true, message: "Program removed." };
}

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

export async function saveTerm(_prev: unknown, formData: FormData): Promise<Result> {
  await requireStaff();
  const parsed = parseForm(TermForm, formData);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const f = parsed.data;

  if (f.endsOn < f.startsOn) {
    return { ok: false, error: "The term has to end after it starts." };
  }

  try {
    await sql.begin(async (tx) => {
      // Exactly one term is current, enforced by a partial unique index. Clear
      // the others first so setting a new one is not a two step dance the user
      // can leave half done.
      if (f.isCurrent) await tx`update terms set is_current = false where is_current`;

      if (f.termId) {
        await tx`update terms
                    set name = ${f.name}, starts_on = ${f.startsOn}::date,
                        ends_on = ${f.endsOn}::date, is_current = ${f.isCurrent}
                  where id = ${f.termId}`;
      } else {
        await tx`insert into terms (name, starts_on, ends_on, is_current)
                 values (${f.name}, ${f.startsOn}::date, ${f.endsOn}::date, ${f.isCurrent})`;
      }
    });
  } catch (err) {
    return { ok: false, error: uniqueMessage(err, `A term called ${f.name} already exists.`) };
  }

  refresh();
  return { ok: true, message: `${f.name} saved.` };
}

export async function deleteTerm(_prev: unknown, formData: FormData): Promise<Result> {
  await requireStaff();
  const id = String(formData.get("termId") ?? "");

  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from class_offerings where term_id = ${id}`;
  if (n > 0) {
    return { ok: false, error: `${n} class${n === 1 ? "" : "es"} are in this term.` };
  }

  await sql`delete from terms where id = ${id}`;
  refresh();
  return { ok: true, message: "Term removed." };
}

// ---------------------------------------------------------------------------
// Offerings. The one with teeth.
// ---------------------------------------------------------------------------

export async function saveOffering(_prev: unknown, formData: FormData): Promise<Result> {
  await requireStaff();
  const parsed = parseForm(OfferingForm, formData);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const f = parsed.data;
  const notifyFamilies = formData.get("notifyFamilies") === "on";

  try {
    const outcome = await sql.begin(async (tx) => {
      let id = f.offeringId || null;
      let before: Existing | null = null;

      /**
       * The program, created here if the class form asked for a new one.
       *
       * Inside the same transaction as the class, deliberately. If the class is
       * refused for any of the reasons below, the half-made program it would
       * have belonged to goes with it, rather than being left behind for
       * somebody to trip over in the Programs list next week.
       */
      let programId = f.programId;
      if (programId === "new") {
        const name = (f.newProgramName ?? "").trim();
        const slug = slugify(name);
        const [existing] = await tx<{ id: string }[]>`
          select id from programs where slug = ${slug}`;
        if (existing) {
          // Somebody typed the name of a program that already exists. Use it
          // rather than refusing: they want a class of that program, which is
          // exactly what picking it from the list would have done.
          programId = existing.id;
        } else {
          const [made] = await tx<{ id: string }[]>`
            insert into programs (name, slug, track, subject, active)
            values (${name}, ${slug}, ${f.newProgramTrack}, ${f.newProgramSubject}, true)
            returning id`;
          programId = made.id;
        }
      }

      if (id) {
        const [row] = await tx<Existing[]>`
          select weekday, start_time, end_time, first_session_date, last_session_date,
                 price_cents, seats_taken, title
            from class_offerings where id = ${id}`;
        before = row ?? null;
        if (!before) throw new Error("That class no longer exists.");

        // A capacity below the number of seats already taken is not a smaller
        // class, it is an oversold one. The database check constraint would
        // refuse it as a 500; this refuses it as a sentence.
        if (f.capacity < before.seats_taken) {
          throw new GuardError(
            `${before.seats_taken} seats are already taken, so the capacity cannot go below that. Cancel a registration first if you need to shrink the class.`,
          );
        }
      }

      if (id) {
        await tx`
          update class_offerings
             set school_id = ${f.schoolId}, program_id = ${programId}, term_id = ${f.termId},
                 title = ${f.title}, weekday = ${f.weekday},
                 start_time = ${f.startTime}::time, end_time = ${f.endTime}::time,
                 first_session_date = ${f.firstSessionDate}::date,
                 last_session_date = ${f.lastSessionDate}::date,
                 capacity = ${f.capacity}, price_cents = ${f.priceCents},
                 registration_mode = ${f.registrationMode},
                 external_registration_url = ${f.externalRegistrationUrl},
                 grade_min = ${f.gradeMin}, grade_max = ${f.gradeMax},
                 location = ${f.location}, special_notes = ${f.specialNotes},
                 status = ${f.status}
           where id = ${id}`;
      } else {
        const [row] = await tx<{ id: string }[]>`
          insert into class_offerings
            (school_id, program_id, term_id, title, weekday, start_time, end_time,
             first_session_date, last_session_date, capacity, price_cents,
             registration_mode, external_registration_url, grade_min, grade_max,
             location, special_notes, status, registration_opens_at)
          values
            (${f.schoolId}, ${programId}, ${f.termId}, ${f.title}, ${f.weekday},
             ${f.startTime}::time, ${f.endTime}::time,
             ${f.firstSessionDate}::date, ${f.lastSessionDate}::date,
             ${f.capacity}, ${f.priceCents}, ${f.registrationMode},
             ${f.externalRegistrationUrl}, ${f.gradeMin}, ${f.gradeMax},
             ${f.location}, ${f.specialNotes}, ${f.status}, now())
          returning id`;
        id = row.id;
      }

      // Blackouts are replaced wholesale, then the schedule is regenerated.
      // Regeneration keeps every human decision: a session somebody cancelled
      // stays cancelled, a reschedule stays where it was put.
      await tx`delete from offering_blackouts where class_offering_id = ${id}`;
      for (const d of f.blackoutDates) {
        await tx`insert into offering_blackouts (class_offering_id, blackout_date, reason)
                 values (${id}, ${d}::date, 'No class')
                 on conflict do nothing`;
      }

      const [gen] = await tx<{ scheduled: number; cancelled: number; removed: number }[]>`
        select * from generate_sessions(${id})`;

      // Who is affected, and by what. Named rather than counted, because
      // "14 families" is what makes somebody stop and think.
      const moved =
        before !== null &&
        (before.weekday !== f.weekday ||
          before.start_time.slice(0, 5) !== f.startTime.slice(0, 5) ||
          before.end_time.slice(0, 5) !== f.endTime.slice(0, 5) ||
          iso(before.first_session_date) !== f.firstSessionDate ||
          iso(before.last_session_date) !== f.lastSessionDate);

      const repriced =
        before !== null && before.price_cents !== f.priceCents && before.seats_taken > 0;

      let told = 0;
      if (moved && notifyFamilies) {
        const families = await tx<
          { parent_id: string; email: string; parent_name: string; child_name: string }[]
        >`select distinct p.id as parent_id, p.email, p.full_name as parent_name,
                 ch.first_name || ' ' || ch.last_name as child_name
            from enrollments e
            join children ch on ch.id = e.child_id
            join parents p   on p.id = ch.parent_id
           where e.class_offering_id = ${id} and e.status in ('active','cancellation_requested')`;

        for (const fam of families) {
          await enqueue(tx, {
            template: "schedule_changed",
            toAddress: fam.email,
            toName: fam.parent_name,
            parentId: fam.parent_id,
            classOfferingId: id!,
            payload: {
              parentName: fam.parent_name,
              childName: fam.child_name,
              className: f.title,
              schedule: `${DAY_NAMES[f.weekday]} ${f.startTime.slice(0, 5)} to ${f.endTime.slice(0, 5)}`,
              firstSession: f.firstSessionDate,
              lastSession: f.lastSessionDate,
            },
            // One notice per family per version of the schedule, so pressing
            // save twice does not send it twice.
            dedupeKey: `schedule_changed:${id}:${f.weekday}:${f.startTime}:${f.firstSessionDate}:${f.lastSessionDate}:${fam.parent_id}`,
          });
          told += 1;
        }
      }

      return { id: id!, gen, moved, repriced, told, seatsTaken: before?.seats_taken ?? 0 };
    });

    // Stripe mirrors the catalogue, and only ever for classes we actually sell.
    // Done outside the transaction: a network call is not something to hold a
    // row lock across, and a Stripe failure must not lose the catalogue edit.
    if (f.registrationMode === "keiki_coders" && f.priceCents !== null) {
      await syncStripe(outcome.id, f.title, f.priceCents);
    }

    refresh();

    const bits = [`${f.title} saved.`, `${outcome.gen.scheduled} sessions scheduled`];
    if (outcome.gen.cancelled > 0) bits.push(`${outcome.gen.cancelled} cancelled or on holiday`);
    if (outcome.told > 0) bits.push(`${outcome.told} families told`);
    else if (outcome.moved && outcome.seatsTaken > 0)
      bits.push(`${outcome.seatsTaken} registered families were NOT told`);
    if (outcome.repriced) bits.push("price changed with families already paid");

    return { ok: true, message: `${bits.join(". ")}.` };
  } catch (err) {
    if (err instanceof GuardError) return { ok: false, error: err.message };
    return { ok: false, error: friendly(err) };
  }
}

export async function deleteOffering(_prev: unknown, formData: FormData): Promise<Result> {
  await requireStaff();
  const parsed = parseForm(OfferingIdForm, formData);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from enrollments
     where class_offering_id = ${parsed.data.offeringId}
       and status in ('active','cancellation_requested')`;

  if (n > 0) {
    // Never delete a class people are in. Closing it stops new registrations
    // and leaves everybody's record intact, which is what is actually wanted.
    return {
      ok: false,
      error: `${n} child${n === 1 ? " is" : "ren are"} registered. Set the class to closed instead, or cancel the registrations first and refund them.`,
    };
  }

  await sql`delete from class_offerings where id = ${parsed.data.offeringId}`;
  refresh();
  return { ok: true, message: "Class removed." };
}

/** Copy a class to another campus, which is how their catalogue is shaped. */
export async function duplicateOffering(_prev: unknown, formData: FormData): Promise<Result> {
  await requireStaff();
  const sourceId = String(formData.get("offeringId") ?? "");
  const toSchoolId = String(formData.get("toSchoolId") ?? "");
  if (!sourceId || !toSchoolId) return { ok: false, error: "Pick a campus to copy it to." };

  try {
    const newId = await sql.begin(async (tx) => {
      const [src] = await tx<{ title: string; school_id: string }[]>`
        select title, school_id from class_offerings where id = ${sourceId}`;
      if (!src) throw new GuardError("That class no longer exists.");
      if (src.school_id === toSchoolId) throw new GuardError("It already runs at that campus.");

      const [copy] = await tx<{ id: string }[]>`
        insert into class_offerings
          (school_id, program_id, term_id, title, summary, weekday, start_time, end_time,
           first_session_date, last_session_date, capacity, price_cents, currency,
           registration_mode, external_registration_url, grade_min, grade_max,
           location, special_notes, registration_opens_at, status)
        select ${toSchoolId}, program_id, term_id, title, summary, weekday, start_time,
               end_time, first_session_date, last_session_date, capacity, price_cents,
               currency, registration_mode, external_registration_url, grade_min,
               grade_max, null, special_notes, now(), 'draft'
          from class_offerings where id = ${sourceId}
        returning id`;

      // The holidays follow, because a copy without them generates the wrong
      // number of sessions and nobody would notice until a parent counted.
      await tx`
        insert into offering_blackouts (class_offering_id, blackout_date, reason)
        select ${copy.id}, blackout_date, reason
          from offering_blackouts where class_offering_id = ${sourceId}`;

      await tx`select * from generate_sessions(${copy.id})`;
      return copy.id;
    });

    refresh();
    redirect(`/admin/classes/${newId}/edit`);
  } catch (err) {
    if (err instanceof GuardError) return { ok: false, error: err.message };
    // redirect() throws by design; let it through.
    if (err && typeof err === "object" && "digest" in err) throw err;
    return { ok: false, error: uniqueMessage(err, "That campus already runs a class with this name this term.") };
  }
}

// ---------------------------------------------------------------------------
// Import from their existing system
// ---------------------------------------------------------------------------

export async function runImport(_prev: unknown, formData: FormData): Promise<Result> {
  await requireStaff();
  const parsed = parseForm(ImportForm, formData);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  try {
    const report = await importCatalogue({
      source: LIVE_SOURCE,
      dryRun: parsed.data.dryRun,
    });

    const created = report.offerings.filter((o) => o.action === "created").length;
    const updated = report.offerings.filter((o) => o.action === "updated").length;
    const agree = report.offerings.filter((o) => o.reconciles).length;

    refresh();

    const lead = parsed.data.dryRun ? "Dry run, nothing kept." : "Imported.";
    return {
      ok: true,
      message:
        `${lead} ${report.schools.created} new campuses, ${report.programs.created} new programs, ` +
        `${created} new classes, ${updated} updated. ` +
        `${agree} of ${report.offerings.length} schedules reconcile against their published session counts.` +
        (report.mismatches.length
          ? ` ${report.mismatches.length} do not and need a look.`
          : ""),
    };
  } catch (err) {
    return {
      ok: false,
      error: `Could not read their catalogue: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

class GuardError extends Error {}

const iso = (d: Date | string) =>
  d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['‘’ʻʼ`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function uniqueMessage(err: unknown, friendlyText: string): string {
  const code = (err as { code?: string })?.code;
  if (code === "23505") return friendlyText;
  return friendly(err);
}

function friendly(err: unknown): string {
  const e = err as { code?: string; constraint_name?: string; message?: string };
  if (e?.code === "23514") {
    // A check constraint fired. Name the ones a human can actually act on.
    const named: Record<string, string> = {
      seats_within_capacity: "That capacity is below the number of seats already taken.",
      external_needs_a_destination: "A class the school enrols needs a link to send families to.",
      sold_here_needs_a_price: "A class we sell needs a price.",
      first_session_matches_weekday:
        "The first date has to fall on the day of the week the class runs.",
      session_window_is_ordered: "The last date has to be on or after the first.",
    };
    const hit = e.constraint_name ? named[e.constraint_name] : undefined;
    if (hit) return hit;
  }
  return e?.message ?? "That could not be saved.";
}

/**
 * Keep Stripe in step with the catalogue.
 *
 * Our database owns the class; Stripe holds the money truth. Prices are
 * immutable in Stripe, so a change mints a new one and repoints, and the old
 * price stays attached to the orders that used it. That is the behaviour you
 * want from a system of record: what somebody was actually charged does not
 * change retroactively because a colleague edited a form.
 */
async function syncStripe(offeringId: string, title: string, priceCents: number) {
  const [row] = await sql<
    { stripe_product_id: string | null; stripe_price_id: string | null; school: string }[]
  >`select c.stripe_product_id, c.stripe_price_id, s.name as school
      from class_offerings c join schools s on s.id = c.school_id
     where c.id = ${offeringId}`;
  if (!row) return;

  let productId = row.stripe_product_id;
  let priceId = row.stripe_price_id;

  const current = priceId ? await stripe.prices.retrieve(priceId).catch(() => null) : null;
  const matches = current?.unit_amount === priceCents && current?.active === true;
  if (matches && productId) return;

  if (!productId) {
    const product = await stripe.products.create(
      { name: `${title} (${row.school})`, metadata: { class_offering_id: offeringId } },
      { idempotencyKey: `product:${offeringId}` },
    );
    productId = product.id;
  }

  if (!matches) {
    const price = await stripe.prices.create(
      {
        product: productId,
        unit_amount: priceCents,
        currency: "usd",
        metadata: { class_offering_id: offeringId },
      },
      { idempotencyKey: `price:${offeringId}:${priceCents}` },
    );
    priceId = price.id;
  }

  await sql`update class_offerings
               set stripe_product_id = ${productId}, stripe_price_id = ${priceId}
             where id = ${offeringId}`;
}

// ---------------------------------------------------------------------------
// Pictures
//
// The catalogue already carried an image on a program and a logo on a campus,
// but the only way to set one was to paste a URL into a text box. That is not a
// field an office can use: the picture they have is on somebody's phone or in a
// folder, and "get it onto a public URL first" is the step where a person gives
// up and leaves the field blank.
//
// The buckets and the policies already existed for the importer. This uses them
// through the signed in staff member's own session rather than the service role,
// so the storage policy is the control, exactly as it is for a parent uploading
// a photograph of their child. A member of staff removed from the staff table
// loses this on their next request with no application check to remember.
//
// The image lives on the PROGRAM, not on the class, which is how their Airtable
// models it and why it is right: one upload covers every campus running that
// program, and their catalogue is 28 classes across 13 programs.
// ---------------------------------------------------------------------------

const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

async function putImage(
  file: File,
  bucket: "program-images" | "school-logos",
  slug: string,
): Promise<{ url: string } | { error: string }> {
  if (!file || file.size === 0) return { error: "No file was chosen." };
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: `That file is ${Math.round(file.size / 1024 / 1024)}MB. The limit is 4MB.` };
  }

  const ext = IMAGE_TYPES[file.type];
  if (!ext) {
    return { error: `${file.type || "That file"} is not an image we can use. JPEG, PNG, WebP, AVIF or SVG.` };
  }

  const supabase = await supabaseServer();
  const key = `${slug}.${ext}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(key, file, { contentType: file.type, upsert: true });

  if (error) {
    // A storage policy refusal and an expired session look identical from here,
    // and the second one is by far the likelier, so say the useful thing.
    return {
      error: /row-level security|not authorized|jwt/i.test(error.message)
        ? "Your sign in seems to have expired. Sign in again and retry."
        : `Storage refused it: ${error.message}`,
    };
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(key);

  // One object per record, overwritten in place, plus a version so a browser and
  // the CDN both fetch the new bytes. Without it the old picture keeps showing
  // and the upload looks like it silently failed. The alternative, a fresh key
  // every time, leaves orphaned files behind forever.
  return { url: `${data.publicUrl}?v=${Date.now().toString(36)}` };
}

export async function uploadProgramImage(_prev: unknown, formData: FormData): Promise<Result> {
  await requireStaff();
  const programId = String(formData.get("programId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file was chosen." };

  const [row] = await sql<{ slug: string }[]>`
    select slug from programs where id = ${programId}`;
  if (!row) return { ok: false, error: "That program no longer exists." };

  const put = await putImage(file, "program-images", row.slug);
  if ("error" in put) return { ok: false, error: put.error };

  await sql`update programs set image_url = ${put.url} where id = ${programId}`;
  refresh();
  return { ok: true, message: "Picture updated everywhere this program runs." };
}

export async function uploadCampusLogo(_prev: unknown, formData: FormData): Promise<Result> {
  await requireStaff();
  const schoolId = String(formData.get("schoolId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file was chosen." };

  const [row] = await sql<{ slug: string }[]>`
    select slug from schools where id = ${schoolId}`;
  if (!row) return { ok: false, error: "That campus no longer exists." };

  const put = await putImage(file, "school-logos", row.slug);
  if ("error" in put) return { ok: false, error: put.error };

  await sql`update schools set logo_url = ${put.url} where id = ${schoolId}`;
  refresh();
  return { ok: true, message: "Logo updated." };
}
