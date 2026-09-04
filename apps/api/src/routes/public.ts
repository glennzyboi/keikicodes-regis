import { Hono } from "hono";
import { sql } from "@keiki/core/db";

/**
 * The public catalogue, in exactly the shape their site already reads.
 *
 * Their Squarespace page has a code block that does this:
 *
 *     var API = 'https://n8n.keikicoders.com/webhook/';
 *     fetch(API + 'get-programs')
 *     fetch(API + 'get-schools')
 *
 * and renders whatever comes back. These two endpoints answer with the same
 * field names, the same types and the same nulls, so migrating their live site
 * off Airtable is a one line change to that variable. Not a rewrite of their
 * website, not a content freeze, not a weekend. One line, and it can be changed
 * back just as fast if anything looks wrong.
 *
 * That is the whole argument for building it this way. A migration nobody can
 * reverse is one nobody will agree to run.
 *
 * The shapes are theirs and are not tidied on the way out. `cost` stays null
 * for the classes a campus enrols itself, `days` stays the English day name,
 * `time` stays "2:45-3:30", and `noClass` stays a comma separated list, because
 * their renderer parses all of it and improving the format here would break the
 * page it is meant to keep working.
 */
export const publicRoutes = new Hono();

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08-12" to "Aug 12, 2026", which is what their cards print. */
function longDate(v: Date | string | null): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "15:15:00" to "3:15", and to "3:15 pm" when it would otherwise read as morning. */
function clock(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")}`;
}

/** "2026-11-11" to "11/11/26", their own format for the no class list. */
function shortDate(v: Date | string): string {
  const d = v instanceof Date ? v : new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
  const yy = String(d.getUTCFullYear()).slice(2);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${yy}`;
}

publicRoutes.get("/schools", async (c) => {
  const rows = await sql<
    { name: string; logo_url: string | null; area: string | null; kind: string | null }[]
  >`select name, logo_url, area, kind
      from schools
     where active
     order by name`;

  return c.json(
    rows.map((r) => ({
      name: r.name,
      logo: r.logo_url,
      area: r.area,
      // Their field is capitalised: Public, Private, Charter.
      type: r.kind ? r.kind.charAt(0).toUpperCase() + r.kind.slice(1) : null,
    })),
  );
});

publicRoutes.get("/programs", async (c) => {
  const rows = await sql<
    {
      title: string;
      grade_label: string | null;
      term_name: string;
      school_name: string;
      location: string | null;
      weekday: number;
      start_time: string;
      end_time: string;
      first_session_date: Date;
      last_session_date: Date;
      price_cents: number | null;
      session_count: number;
      program_image_url: string | null;
      special_notes: string | null;
      program_description: string | null;
      registration_mode: string;
      external_registration_url: string | null;
      blackouts: (Date | null)[];
    }[]
  >`select d.title, d.grade_label, d.term_name, d.school_name, d.location,
           d.weekday, d.start_time, d.end_time,
           d.first_session_date, d.last_session_date,
           d.price_cents, d.session_count, d.program_image_url,
           d.special_notes, d.program_description,
           d.registration_mode, d.external_registration_url,
           coalesce(
             array(select b.blackout_date from offering_blackouts b
                    where b.class_offering_id = d.id
                    order by b.blackout_date),
             '{}') as blackouts
      from offering_details d
     where d.status = 'published'
     order by d.school_name, d.weekday, d.start_time`;

  const siteUrl = process.env.PUBLIC_SITE_URL ?? "https://keikicoders.com";

  return c.json(
    rows.map((r) => ({
      name: r.title,
      grades: r.grade_label,
      season: r.term_name,
      site: r.school_name,
      location: r.location ?? r.school_name,
      days: DAY_NAMES[r.weekday],
      time: `${clock(r.start_time)}–${clock(r.end_time)}`,
      dates: `${longDate(r.first_session_date)} – ${longDate(r.last_session_date)}`,
      // Null for the classes a campus enrols itself, exactly as theirs is.
      cost: r.price_cents === null ? null : Math.round(r.price_cents / 100),
      sessions: r.session_count,
      image: r.program_image_url,
      specialNotes: r.special_notes ?? "",
      description: r.program_description,
      registerUrl:
        r.registration_mode === "external"
          ? r.external_registration_url
          : `${siteUrl}/register`,
      noClass: (r.blackouts.filter(Boolean) as Date[]).map(shortDate).join(", "),
    })),
  );
});

/**
 * Everything the two endpoints above return, plus the ids and the seat counts.
 *
 * Their renderer does not want these, but anything else we build against this
 * data does, and inventing a second, subtly different catalogue endpoint later
 * is how two sources of truth start.
 */
publicRoutes.get("/catalogue", async (c) => {
  const rows = await sql`
    select id, title, status, school_name, school_slug, program_name, program_slug,
           program_track, program_subject, term_name, term_is_current,
           weekday, start_time, end_time, first_session_date, last_session_date,
           session_count, cancelled_count, grade_min, grade_max, grade_label,
           capacity, seats_taken, seats_left, price_cents, currency,
           registration_mode, external_registration_url, location, special_notes
      from offering_details
     where status = 'published'
     order by school_name, weekday, start_time`;
  return c.json(rows);
});
