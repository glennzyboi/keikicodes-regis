import type { FilterSelect } from "@/app/admin/filters";
import type { ClassFilters } from "@/app/admin/class-queries";

/**
 * What can be filtered on a class list, and how a query string becomes filters.
 *
 * Its own module because three pages need it: the Classes list, and the campus
 * and program pages that are the same list with one filter already applied.
 * Keeping it here is what stops those three growing three slightly different
 * ideas of what "full" means.
 *
 * Every value is normalised against a fixed set before it reaches SQL. That is
 * not only about injection, which bound parameters already handle: an
 * unrecognised `?status=banana` should render the normal page, not an empty one
 * that reads as "there are no classes".
 */

export const DAY_OPTIONS = [
  { value: "1", label: "Mondays" },
  { value: "2", label: "Tuesdays" },
  { value: "3", label: "Wednesdays" },
  { value: "4", label: "Thursdays" },
  { value: "5", label: "Fridays" },
  { value: "0", label: "Sundays" },
  { value: "6", label: "Saturdays" },
];

const STATUS = [
  { value: "published", label: "Published" },
  { value: "draft", label: "Draft" },
  { value: "closed", label: "Closed" },
];

const MODE = [
  { value: "keiki_coders", label: "Keiki Coders takes it" },
  { value: "external", label: "The campus takes it" },
];

/**
 * How full, in the four states somebody actually asks about.
 *
 * "Not reconciling" is in the same dropdown deliberately. It is the one that
 * means something is wrong rather than something is busy, and burying it on a
 * separate page is how a counter drifts for a fortnight before anyone looks.
 */
const FILL = [
  { value: "open", label: "Has seats left" },
  { value: "full", label: "Full" },
  { value: "empty", label: "Nobody yet" },
  { value: "drift", label: "Does not reconcile" },
];

const oneOf = (value: string | undefined, allowed: { value: string }[]) =>
  allowed.some((a) => a.value === value) ? value : undefined;

export type ClassFilterOptions = {
  schools: { id: string; name: string }[];
  programs: { id: string; name: string }[];
  terms: { id: string; name: string; is_current: boolean }[];
  tracks: string[];
  currentTermId: string | null;
};

export function classFiltersFrom(
  params: Record<string, string | undefined>,
  currentTermId: string | null,
  /** Fixed by the page you are on, such as a campus page. Not user editable. */
  pinned: Partial<ClassFilters> = {},
): { filters: ClassFilters; termValue: string } {
  // Absent means the current term, "all" means every term. A default nobody can
  // see is a lie about what is on screen, so this one is always shown as a chip
  // and removing it widens rather than resetting.
  const raw = params.term;
  const term = raw === "all" ? undefined : (raw ?? currentTermId ?? undefined);

  return {
    termValue: raw === "all" ? "all" : (raw ?? currentTermId ?? "all"),
    filters: {
      q: params.q?.trim() || undefined,
      school: uuid(params.school),
      program: uuid(params.program),
      term,
      track: params.track || undefined,
      status: oneOf(params.status, STATUS),
      mode: oneOf(params.mode, MODE),
      weekday: params.weekday && /^[0-6]$/.test(params.weekday) ? params.weekday : undefined,
      fill: oneOf(params.fill, FILL),
      ...pinned,
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: string | undefined) => (v && UUID.test(v) ? v : undefined);

export function classSelects(
  params: Record<string, string | undefined>,
  options: ClassFilterOptions,
  termValue: string,
  /** Filters the page itself fixes, so they are not offered twice. */
  hide: ("school" | "program" | "term")[] = [],
): FilterSelect[] {
  const all: FilterSelect[] = [
    {
      name: "term",
      label: "Term",
      value: termValue,
      clearTo: "all",
      options: [
        { value: "all", label: "Every term" },
        ...options.terms.map((t) => ({
          value: t.id,
          label: t.is_current ? `${t.name} (current)` : t.name,
        })),
      ],
    },
    {
      name: "school",
      label: "Campus",
      value: uuid(params.school),
      anyLabel: "All campuses",
      options: options.schools.map((s) => ({ value: s.id, label: s.name })),
    },
    {
      name: "program",
      label: "Program",
      value: uuid(params.program),
      anyLabel: "All programs",
      options: options.programs.map((p) => ({ value: p.id, label: p.name })),
    },
    {
      name: "track",
      label: "Level",
      value: params.track || undefined,
      anyLabel: "All levels",
      options: options.tracks.map((t) => ({ value: t, label: t })),
    },
    {
      name: "weekday",
      label: "Day",
      value: params.weekday && /^[0-6]$/.test(params.weekday) ? params.weekday : undefined,
      anyLabel: "Any day",
      options: DAY_OPTIONS,
    },
    {
      name: "fill",
      label: "Seats",
      value: oneOf(params.fill, FILL),
      anyLabel: "Any fill",
      options: FILL,
    },
    {
      name: "status",
      label: "Status",
      value: oneOf(params.status, STATUS),
      anyLabel: "Any status",
      options: STATUS,
    },
    {
      name: "mode",
      label: "Registration",
      value: oneOf(params.mode, MODE),
      anyLabel: "Either registration",
      options: MODE,
    },
  ];

  return all.filter((s) => !hide.includes(s.name as "school" | "program" | "term"));
}
