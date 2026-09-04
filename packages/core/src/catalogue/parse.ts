/**
 * Reading their catalogue.
 *
 * Their Squarespace site calls two n8n webhooks over Airtable and renders
 * whatever comes back. The records are written by people, for people, so the
 * fields are prose: a date range as "Aug 12, 2026 - Dec 16, 2026", a time as
 * "3:00 pm-4:00 pm" or just "2:45-3:30", grades as "K-2", and the holidays as
 * a comma separated list with inconsistent padding and two different year
 * formats.
 *
 * Everything in this file is a pure function over that text. No database, no
 * network. That is deliberate: parsing somebody else's hand-maintained data is
 * exactly the part that will surprise us, so it is the part that has to be
 * testable without a stack running.
 *
 * The shapes are theirs, not ours. Where their data cannot answer something we
 * need, the parser says so rather than inventing a value quietly.
 */

/** One record from their get-programs webhook, exactly as it arrives. */
export type RawProgram = {
  name: string;
  grades: string | null;
  season: string | null;
  site: string | null;
  location: string | null;
  days: string | null;
  time: string | null;
  dates: string | null;
  cost: number | null;
  sessions: number | null;
  image: string | null;
  specialNotes: string | null;
  description: string | null;
  registerUrl: string | null;
  noClass: string | null;
};

/** One record from their get-schools webhook. */
export type RawSchool = {
  name: string;
  logo: string | null;
  area: string | null;
  type: string | null;
};

export type Snapshot = {
  capturedAt?: string;
  schools: RawSchool[];
  programs: RawProgram[];
};

export type ParsedSchool = {
  name: string;
  slug: string;
  kind: "public" | "private" | "charter" | null;
  area: string | null;
  logoUrl: string | null;
};

export type ParsedOffering = {
  /** What a family reads, qualifiers included. */
  title: string;
  /** The curriculum behind it, with any campus qualifier removed. */
  programName: string;
  programSlug: string;
  track: string | null;
  subject: string | null;
  description: string | null;
  imageUrl: string | null;

  schoolName: string;
  termName: string;
  location: string | null;
  specialNotes: string | null;

  weekday: number;
  startTime: string;
  endTime: string;
  firstSessionDate: string;
  lastSessionDate: string;
  blackoutDates: string[];

  gradeMin: number | null;
  gradeMax: number | null;

  registrationMode: "keiki_coders" | "external";
  externalRegistrationUrl: string | null;
  priceCents: number | null;

  /** Their own stated session count, kept only to reconcile against ours. */
  statedSessions: number | null;

  /** Anything we could not read, reported rather than swallowed. */
  problems: string[];
};

const DASH = /\s*[–—-]\s*/; // they use en dashes, mostly

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/**
 * A slug that reads like the name.
 *
 * Apostrophes are removed rather than turned into separators, which matters
 * here more than it usually would: half these campuses are Hawaiian names, and
 * naive slugging turns Wai'alae into "wai-alae", Hanahauʻoli into
 * "hanahau-oli" and Nuʻuanu into "nu-uanu". The ʻokina is a letter,
 * not punctuation, and a URL that breaks the word in half is one a parent
 * cannot read back to somebody over the phone.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // straight, curly and the Hawaiian ʻokina
    .replace(/['‘’ʻʼ`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** "Wednesday" to 3. Their days field is always a single day today. */
export function parseWeekday(days: string | null): number | null {
  if (!days) return null;
  const first = days.split(",")[0]?.trim().toLowerCase();
  if (!first) return null;
  const key = Object.keys(WEEKDAYS).find((d) => d.startsWith(first.slice(0, 3)));
  return key ? WEEKDAYS[key] : null;
}

/**
 * "3:00 pm" to "15:00:00", and "2:45" to "14:45:00".
 *
 * Half their records carry a meridiem and half do not, because these are all
 * after school classes and everyone writing them knows what they mean. An hour
 * below 8 with nothing after it is the afternoon; that is true of every record
 * they have, and anything outside it is reported rather than guessed at.
 */
export function parseClockTime(value: string): { time: string | null; problem?: string } {
  const m = value.trim().toLowerCase().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?/);
  if (!m) return { time: null, problem: `unreadable time "${value}"` };

  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const meridiem = m[3];

  if (minute > 59) return { time: null, problem: `impossible minute in "${value}"` };

  if (meridiem === "pm" && hour !== 12) hour += 12;
  else if (meridiem === "am" && hour === 12) hour = 0;
  else if (!meridiem) {
    if (hour >= 1 && hour < 8) hour += 12;
    else if (hour > 12) {
      /* already 24 hour, leave it */
    }
  }

  if (hour > 23) return { time: null, problem: `impossible hour in "${value}"` };
  return { time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00` };
}

/** "4:15-5:15" to a start and an end. */
export function parseTimeRange(value: string | null): {
  start: string | null;
  end: string | null;
  problems: string[];
} {
  const problems: string[] = [];
  if (!value) return { start: null, end: null, problems: ["no time given"] };

  const parts = value.split(DASH).filter(Boolean);
  if (parts.length < 2) return { start: null, end: null, problems: [`no time range in "${value}"`] };

  const a = parseClockTime(parts[0]);
  const b = parseClockTime(parts[1]);
  if (a.problem) problems.push(a.problem);
  if (b.problem) problems.push(b.problem);
  if (a.time && b.time && b.time <= a.time) problems.push(`"${value}" ends before it starts`);

  return { start: a.time, end: b.time, problems };
}

/** "Aug 12, 2026" to "2026-08-12". */
export function parseLongDate(value: string): string | null {
  const m = value.trim().toLowerCase().match(/^([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3)];
  if (!month) return null;
  return iso(Number(m[3]), month, Number(m[2]));
}

/** "Aug 12, 2026 - Dec 16, 2026" to a first and a last. */
export function parseDateRange(value: string | null): {
  first: string | null;
  last: string | null;
  problems: string[];
} {
  const problems: string[] = [];
  if (!value) return { first: null, last: null, problems: ["no dates given"] };

  const parts = value.split(DASH).filter((p) => p.trim());
  if (parts.length < 2) return { first: null, last: null, problems: [`no date range in "${value}"`] };

  const first = parseLongDate(parts[0]);
  const last = parseLongDate(parts[1]);
  if (!first) problems.push(`unreadable start date in "${value}"`);
  if (!last) problems.push(`unreadable end date in "${value}"`);
  if (first && last && last < first) problems.push(`"${value}" ends before it starts`);

  return { first, last, problems };
}

/**
 * "10/07/26, 11/4/26, 12/4/2026" to ISO dates.
 *
 * Two year formats, inconsistent zero padding, and a trailing comma on several
 * records. Dates that do not fall on the class weekday are kept rather than
 * dropped: their lists are copied between programs at a campus, so a Wednesday
 * class carries a Friday holiday, and the generator simply never meets it. That
 * is their intent preserved, not a bug reproduced.
 */
export function parseBlackoutDates(value: string | null): { dates: string[]; problems: string[] } {
  const problems: string[] = [];
  if (!value || !value.trim()) return { dates: [], problems };

  const dates: string[] = [];
  for (const piece of value.split(",")) {
    const t = piece.trim();
    if (!t) continue;
    const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (!m) {
      problems.push(`unreadable blackout date "${t}"`);
      continue;
    }
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      problems.push(`impossible blackout date "${t}"`);
      continue;
    }
    const d = iso(year, month, day);
    if (!dates.includes(d)) dates.push(d);
  }
  return { dates: dates.sort(), problems };
}

/** "K-2" to 0 and 2. "6-8" to 6 and 8. "1" to 1 and 1. */
export function parseGrades(value: string | null): {
  min: number | null;
  max: number | null;
  problem?: string;
} {
  if (!value || !value.trim()) return { min: null, max: null };
  const parts = value.trim().split(DASH).filter(Boolean);
  const one = (g: string): number | null => {
    const t = g.trim().toLowerCase();
    if (t === "k" || t === "kindergarten") return 0;
    if (t === "pk" || t === "prek" || t === "pre-k") return 0;
    const n = Number(t);
    return Number.isInteger(n) && n >= 0 && n <= 12 ? n : null;
  };
  const min = one(parts[0]);
  const max = parts.length > 1 ? one(parts[1]) : min;
  if (min === null || max === null) return { min: null, max: null, problem: `unreadable grades "${value}"` };
  return { min, max };
}

/**
 * The curriculum behind an offering title.
 *
 * Liholiho runs one curriculum twice on a Thursday afternoon, as "(A+ students
 * only)" and "(non A+ students)"; Koko Head labels its single class "(all
 * students)". The parenthetical is a campus arrangement, not a different course,
 * so it stays on the offering and comes off the program.
 */
export function programNameFor(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** "Code Heroes: Virtual Reality" to its level and its subject. */
export function splitProgramName(name: string): { track: string | null; subject: string | null } {
  const i = name.indexOf(":");
  if (i === -1) return { track: null, subject: null };
  return { track: name.slice(0, i).trim() || null, subject: name.slice(i + 1).trim() || null };
}

/**
 * Move a start date forward to the first occurrence of the class weekday.
 *
 * Their range start and their listed day agree on every current record, but
 * nothing in their system makes them, and a schedule whose first date is not on
 * its own weekday generates the wrong dates in silence. The database has a
 * constraint for this; the importer makes sure it is never hit.
 */
export function alignToWeekday(isoDate: string, weekday: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const shift = (weekday - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + shift);
  return d.toISOString().slice(0, 10);
}

/** How many sessions the schedule produces, so we can check theirs against ours. */
export function countSessions(
  first: string,
  last: string,
  weekday: number,
  blackouts: string[],
): number {
  let n = 0;
  const end = new Date(`${last}T00:00:00Z`);
  for (const d = new Date(`${first}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
    const key = d.toISOString().slice(0, 10);
    if (d.getUTCDay() !== weekday) continue;
    if (blackouts.includes(key)) continue;
    n += 1;
  }
  return n;
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseSchool(raw: RawSchool): ParsedSchool {
  const kind = (raw.type ?? "").trim().toLowerCase();
  return {
    name: raw.name.trim(),
    slug: slugify(raw.name),
    kind: kind === "public" || kind === "private" || kind === "charter" ? kind : null,
    area: raw.area?.trim() || null,
    logoUrl: raw.logo?.trim() || null,
  };
}

/**
 * One of their program records, read into the shape our catalogue holds.
 *
 * Two things are decided here rather than in the database. Registration mode
 * comes from where their register link points: on their own domain we sell it,
 * anywhere else the campus does and we must never take money for it. And the
 * price is only meaningful in the first case, which is why it is nullable.
 *
 * These are the same 13 records either way. Their `cost` is set on exactly the
 * offerings whose link is on keikicoders.com, so the two agree, and a record
 * where they disagree is reported as a problem instead of being resolved by
 * guessing which field to believe.
 */
export function parseOffering(raw: RawProgram): ParsedOffering | null {
  const problems: string[] = [];
  const title = (raw.name ?? "").trim();
  if (!title) return null;

  const schoolName = (raw.site ?? "").trim();
  if (!schoolName) problems.push("no school");

  const weekday = parseWeekday(raw.days);
  if (weekday === null) problems.push(`unreadable day "${raw.days ?? ""}"`);

  const times = parseTimeRange(raw.time);
  problems.push(...times.problems);

  const range = parseDateRange(raw.dates);
  problems.push(...range.problems);

  const blackouts = parseBlackoutDates(raw.noClass);
  problems.push(...blackouts.problems);

  const grades = parseGrades(raw.grades);
  if (grades.problem) problems.push(grades.problem);

  const url = (raw.registerUrl ?? "").trim();
  let host = "";
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    if (url) problems.push(`unreadable register link "${url}"`);
  }
  const ours = host.endsWith("keikicoders.com");
  const mode: "keiki_coders" | "external" = ours ? "keiki_coders" : "external";

  if (mode === "external" && !url) problems.push("registered elsewhere but no link to send families to");
  if (mode === "keiki_coders" && raw.cost == null) problems.push("sold by us but has no price");
  if (mode === "external" && raw.cost != null) {
    problems.push("registered elsewhere but carries a price, which we will not charge");
  }

  const programName = programNameFor(title);
  const { track, subject } = splitProgramName(programName);

  const firstAligned =
    range.first && weekday !== null ? alignToWeekday(range.first, weekday) : range.first;

  return {
    title,
    programName,
    programSlug: slugify(programName),
    track,
    subject,
    description: raw.description?.trim() || null,
    imageUrl: raw.image?.trim() || null,

    schoolName,
    termName: (raw.season ?? "").trim() || "Unscheduled",
    location: raw.location?.trim() || null,
    specialNotes: raw.specialNotes?.trim() || null,

    weekday: weekday ?? 0,
    startTime: times.start ?? "15:00:00",
    endTime: times.end ?? "16:00:00",
    firstSessionDate: firstAligned ?? "",
    lastSessionDate: range.last ?? "",
    blackoutDates: blackouts.dates,

    gradeMin: grades.min,
    gradeMax: grades.max,

    registrationMode: mode,
    externalRegistrationUrl: mode === "external" ? url || null : null,
    priceCents: mode === "keiki_coders" && raw.cost != null ? Math.round(raw.cost * 100) : null,

    statedSessions: raw.sessions ?? null,
    problems,
  };
}

/** Everything readable in a snapshot, with the unreadable listed separately. */
export function parseSnapshot(snap: Snapshot): {
  schools: ParsedSchool[];
  offerings: ParsedOffering[];
  unusable: { title: string; problems: string[] }[];
} {
  const schools = (snap.schools ?? []).map(parseSchool);
  const offerings: ParsedOffering[] = [];
  const unusable: { title: string; problems: string[] }[] = [];

  for (const raw of snap.programs ?? []) {
    const parsed = parseOffering(raw);
    if (!parsed) continue;
    // A record we cannot place in time is not a class, it is a note. Everything
    // else goes in carrying its problems, so the office can see and fix them.
    if (!parsed.firstSessionDate || !parsed.lastSessionDate || !parsed.schoolName) {
      unusable.push({ title: parsed.title, problems: parsed.problems });
      continue;
    }
    offerings.push(parsed);
  }

  return { schools, offerings, unusable };
}
