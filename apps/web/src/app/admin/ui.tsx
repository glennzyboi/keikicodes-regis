import Link from "next/link";
import { formatMoney } from "@keiki/core/money";

/**
 * The small shared vocabulary of the console.
 *
 * Kept in one file so a status pill means the same thing on every tab. Icons
 * are inline SVG rather than a package: there are nine of them, and a runtime
 * dependency for nine paths is not a trade worth making.
 */

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}

export type IconName = keyof typeof PATHS;

const PATHS = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  card: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2.5" />
      <path d="M2 10h20" />
    </>
  ),
  undo: (
    <>
      <path d="M3 7v6h6" />
      <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
    </>
  ),
  cash: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2.5" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 5.5v15" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6" />
      <path d="M17.5 14.2A6.5 6.5 0 0 1 21.5 20" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  warning: (
    <>
      <path d="M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  child: (
    <>
      <circle cx="12" cy="7" r="3.4" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  mail: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  note: (
    <>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5v15L12 16l-7 3.5z" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 4v5h-5" />
    </>
  ),
  check: <path d="m4 12.5 5 5L20 6.5" />,
  up: <path d="M12 19V5m0 0-6 6m6-6 6 6" />,
  down: <path d="M12 5v14m0 0 6-6m-6 6-6-6" />,
  building: (
    <>
      <path d="M4 21V5.5A1.5 1.5 0 0 1 5.5 4h7A1.5 1.5 0 0 1 14 5.5V21" />
      <path d="M14 10h4.5A1.5 1.5 0 0 1 20 11.5V21M2.5 21h19" />
      <path d="M7 8h4M7 12h4M7 16h4M17 14h.01M17 17.5h.01" />
    </>
  ),
  upload: (
    <>
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
      <path d="M12 4v11m0-11 4 4m-4-4-4 4" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5z" />
      <path d="m3 13 9 5 9-5M3 16.5l9 5 9-5" />
    </>
  ),
  filter: (
    <>
      <path d="M3 5h18l-7 8v6l-4 2v-8L3 5z" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  image: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" />
    </>
  ),
};

export function Pill({
  tone,
  children,
}: {
  tone: "good" | "warn" | "danger" | "quiet" | "info";
  children: React.ReactNode;
}) {
  return <span className={`ops-pill ops-pill-${tone}`}>{children}</span>;
}

/** One consistent reading of a refund's state, wherever it is shown. */
export function refundTone(status: string | null) {
  if (status === "succeeded") return "good" as const;
  if (status === "failed") return "danger" as const;
  if (status === "pending") return "warn" as const;
  return "quiet" as const;
}

export function Stat({
  label,
  value,
  note,
  icon,
  tint = "accent",
  delta,
  spark,
}: {
  label: string;
  value: string;
  note?: string;
  icon: IconName;
  tint?: "accent" | "good" | "warn" | "danger" | "violet";
  delta?: { pct: number; label: string } | null;
  spark?: number[];
}) {
  return (
    <div className="ops-panel ops-stat ops-enter">
      <div className="flex items-start justify-between gap-3">
        <div
          className="ops-stat-icon"
          style={{
            background: `var(--ops-${tint}-soft)`,
            color: `var(--ops-${tint})`,
          }}
        >
          <Icon name={icon} />
        </div>
        {spark && spark.length > 1 && <Spark values={spark} tint={tint} />}
      </div>

      <p className="ops-label mt-3">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="ops-stat-value">{value}</span>
        {delta && (
          <span
            className={`ops-delta ${
              delta.pct > 0 ? "ops-delta-up" : delta.pct < 0 ? "ops-delta-down" : "ops-delta-flat"
            }`}
          >
            {delta.pct !== 0 && <Icon name={delta.pct > 0 ? "up" : "down"} size={11} />}
            {delta.label}
          </span>
        )}
      </div>
      {note && <p className="mt-1 text-[var(--ops-muted)]">{note}</p>}
    </div>
  );
}

/**
 * A sparkline, drawn as SVG on the server.
 *
 * No charting library. Seven numbers do not justify shipping one, and this
 * renders with the HTML instead of after it.
 */
export function Spark({ values, tint = "accent" }: { values: number[]; tint?: string }) {
  const w = 68;
  const h = 26;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? w / (values.length - 1) : w;

  const points = values.map((v, i) => [i * step, h - (v / max) * (h - 3) - 1.5] as const);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      <polyline
        points={line}
        fill="none"
        stroke={`var(--ops-${tint})`}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Money({ cents }: { cents: number }) {
  return <span className="font-semibold">{formatMoney(cents)}</span>;
}

export function EmptyState({ icon, title, note }: { icon: IconName; title: string; note: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div
        className="ops-stat-icon"
        style={{ background: "var(--ops-good-soft)", color: "var(--ops-good)" }}
      >
        <Icon name={icon} />
      </div>
      <p className="mt-3 font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-[var(--ops-muted)]">{note}</p>
    </div>
  );
}

export function PageHead({
  title,
  note,
  actions,
}: {
  title: string;
  note: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[21px] font-semibold">{title}</h1>
        <p className="mt-1 max-w-2xl text-[var(--ops-muted)]">{note}</p>
      </div>
      {actions}
    </div>
  );
}

/** Initials for an avatar chip, from whatever name we actually hold. */
export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** A stable colour per person, so the same family keeps the same chip. */
export function tintFor(seed: string) {
  const palette = ["#2563eb", "#7839ee", "#067a51", "#b54708", "#b42318", "#0e7490"];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

export function when(d: Date, timezone = "Pacific/Honolulu") {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(d);
}

export function ago(minutes: number) {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

/**
 * A search box that submits as a GET, so the result is a real URL.
 *
 * Staff share links to each other. "The Kealoha family" pasted into a chat
 * should open the same thing for the person receiving it, which a client side
 * filter cannot do.
 */
export function PageSearch({
  action,
  q,
  placeholder,
}: {
  action: string;
  q?: string;
  placeholder: string;
}) {
  return (
    <form className="flex gap-2" action={action}>
      <div className="relative max-w-md flex-1">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder={placeholder}
          className="ops-field w-full pl-8"
          aria-label="Search"
        />
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ops-faint)]">
          <Icon name="search" size={14} />
        </span>
      </div>
      <button className="ops-btn">Search</button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

/**
 * How many rows a console page shows before it pages.
 *
 * Every list here was a bare `limit 100` (or 200, or 300), which is not paging.
 * It is a silent truncation: the hundred and first family simply does not
 * exist, the page gives no hint of it, and the only way to find them is the
 * search box. With 1,500 children across 20 schools that is not hypothetical.
 *
 * Ten rather than twenty five, so a list fits on a laptop screen without
 * scrolling and a dashboard section does not push everything below it off the
 * page.
 */
export const PER_PAGE = 10;

/** The page number from a query string, clamped so ?page=-4 cannot happen. */
export function pageFrom(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/**
 * The pager itself.
 *
 * Links rather than buttons, so a page is a URL: a colleague can be sent
 * "families, page 3" and see the same thing, back works, and the whole control
 * needs no client JavaScript at all. It also states the range and the total,
 * because "page 3 of 12" answers a different question from "showing 51 to 75 of
 * 291" and staff ask the second one.
 */
export function Pager({
  page,
  total,
  perPage = PER_PAGE,
  basePath,
  params = {},
  anchor,
}: {
  page: number;
  total: number;
  perPage?: number;
  basePath: string;
  /** Everything else in the query string, carried across so a filter survives. */
  params?: Record<string, string | undefined>;
  /** A section id, so paging a widget on a long page returns you to it. */
  anchor?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (total === 0) return null;

  const href = (n: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    if (n > 1) q.set("page", String(n));
    const s = q.toString();
    const hash = anchor ? `#${anchor}` : "";
    return (s ? `${basePath}?${s}` : basePath) + hash;
  };

  const first = (page - 1) * perPage + 1;
  const last = Math.min(page * perPage, total);

  // A window around the current page. Twelve pages of numbers is a wall, and
  // nobody navigates to page 7 of 12 by name.
  const window: number[] = [];
  for (let n = Math.max(1, page - 2); n <= Math.min(pages, page + 2); n++) window.push(n);

  return (
    <nav className="ops-pager" aria-label="Pages">
      <span>
        {first}
        {last > first && <> to {last}</>} of {total}
      </span>

      {pages > 1 && (
        <span className="ops-pager-pages">
          <PagerLink href={href(page - 1)} disabled={page <= 1} label="Previous page">
            &larr;
          </PagerLink>
          {window[0] > 1 && (
            <>
              <PagerLink href={href(1)} label="Page 1">
                1
              </PagerLink>
              {window[0] > 2 && <span className="px-1">&hellip;</span>}
            </>
          )}
          {window.map((n) => (
            <PagerLink key={n} href={href(n)} current={n === page} label={`Page ${n}`}>
              {n}
            </PagerLink>
          ))}
          {window[window.length - 1] < pages && (
            <>
              {window[window.length - 1] < pages - 1 && <span className="px-1">&hellip;</span>}
              <PagerLink href={href(pages)} label={`Page ${pages}`}>
                {pages}
              </PagerLink>
            </>
          )}
          <PagerLink href={href(page + 1)} disabled={page >= pages} label="Next page">
            &rarr;
          </PagerLink>
        </span>
      )}
    </nav>
  );
}

function PagerLink({
  href,
  children,
  current,
  disabled,
  label,
}: {
  href: string;
  children: React.ReactNode;
  current?: boolean;
  disabled?: boolean;
  label: string;
}) {
  if (disabled) {
    return (
      <span className="ops-btn" aria-disabled="true" style={{ opacity: 0.4 }}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="ops-btn"
      data-chosen={current || undefined}
      aria-label={label}
      aria-current={current ? "page" : undefined}
    >
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

/**
 * What a page looks like while it is still arriving.
 *
 * Not a spinner. A spinner says "something is happening"; a skeleton says "a
 * table with about this many rows is coming", which stops the layout jumping
 * when it does and makes the wait feel shorter than it is even though it is
 * exactly as long.
 *
 * Every one of these is decoration for a screen reader, so the region is
 * aria-hidden and the announcement is one polite "Loading" rather than forty
 * empty table cells.
 */
export function Skeleton({
  w = "100%",
  h = 12,
  className = "",
}: {
  w?: string | number;
  h?: number;
  className?: string;
}) {
  return <span className={`ops-skel block ${className}`} style={{ width: w, height: h }} />;
}

export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  // Varied widths, because a grid of identical grey bars reads as a broken
  // table rather than as text that has not arrived.
  const widths = ["70%", "45%", "85%", "35%", "60%", "50%"];
  return (
    <div aria-hidden className="overflow-hidden">
      {/*
        `.ops-skel-table`, not `.ops-table`, and the reason is real rather than
        cosmetic. These now sit in Suspense fallbacks inside the page rather than
        in a `loading.tsx` that is swapped out wholesale, so while a list streams
        the fallback and the real rows are briefly in the document together. Two
        elements matching `.ops-table` is a strict mode violation in Playwright,
        which fails instantly instead of retrying: every list in the console had
        just acquired a race that would fail a test roughly whenever the machine
        was busy. Same styling, different name, no ambiguity.
      */}
      <table className="ops-skel-table">
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c}>
                  <Skeleton w={widths[(r + c) % widths.length]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PageSkeleton({
  stats = 0,
  rows = 8,
  cols = 5,
}: {
  stats?: number;
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="space-y-4">
      <span className="sr-only" role="status">
        Loading
      </span>
      <div aria-hidden>
        <Skeleton w={180} h={20} />
        <Skeleton w={380} h={12} className="mt-2" />
      </div>

      {stats > 0 && (
        <div aria-hidden className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: stats }, (_, i) => (
            <div key={i} className="ops-panel p-4">
              <Skeleton w={70} h={9} />
              <Skeleton w={110} h={24} className="mt-3" />
              <Skeleton w={90} h={9} className="mt-3" />
            </div>
          ))}
        </div>
      )}

      <div className="ops-panel">
        <div aria-hidden className="ops-panel-head">
          <Skeleton w={140} h={14} />
        </div>
        <TableSkeleton rows={rows} cols={cols} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type SortDir = "asc" | "desc";

/**
 * Read a sort from the query string, against a fixed set of keys.
 *
 * **The allowlist is the security control, not a tidiness measure.** A column
 * name taken from a URL and pasted into an ORDER BY is a SQL injection hole,
 * and it is the classic one, because it is the one place a parameter cannot be
 * bound. Anything not in the list falls back to the default, silently, which is
 * also why `?sort=' or 1=1--` renders a normal page instead of an error that
 * tells somebody they are close.
 */
export function sortFrom<K extends string>(
  value: string | undefined,
  dir: string | undefined,
  allowed: readonly K[],
  fallback: K,
  /**
   * Which way round the fallback column reads.
   *
   * Descending is right for money, dates and counts, where the interesting end
   * is the big one, and it was the only option. It is wrong for a name: a
   * program list that opens at "STEM Juniors" and works backwards to "Code
   * Explorers" is a list nobody can find anything in, and it is not obviously a
   * bug so nobody reports it, they just use the search box instead.
   */
  fallbackDir: SortDir = "desc",
): { sort: K; dir: SortDir } {
  const sort = (allowed as readonly string[]).includes(value ?? "") ? (value as K) : fallback;
  return { sort, dir: dir === "asc" ? "asc" : dir === "desc" ? "desc" : fallbackDir };
}

/**
 * A column header you can press to sort by it.
 *
 * A link, not a button, so the sorted view is a URL somebody can send. Pressing
 * the column you are already sorted by flips the direction, which is what every
 * table in the world does and what people try first.
 *
 * `aria-sort` on the cell is what a screen reader announces; the arrow is for
 * everybody else. Paging resets to page one, because staying on page 4 of a
 * list you just reordered shows you rows that have nothing to do with what you
 * clicked.
 */
export function SortHeader({
  label,
  column,
  current,
  dir,
  basePath,
  params = {},
  numeric,
}: {
  label: string;
  column: string;
  current: string;
  dir: SortDir;
  basePath: string;
  params?: Record<string, string | undefined>;
  numeric?: boolean;
}) {
  const active = current === column;
  const nextDir: SortDir = active && dir === "desc" ? "asc" : "desc";

  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  q.set("sort", column);
  q.set("dir", nextDir);

  return (
    <th
      className={numeric ? "ops-num" : undefined}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <Link href={`${basePath}?${q.toString()}`} className="ops-sort" data-active={active || undefined}>
        {label}
        <span className="ops-sort-mark" aria-hidden>
          {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </Link>
    </th>
  );
}

/**
 * The whole row, as one link.
 *
 * A stretched pseudo-element rather than wrapping every cell in an anchor,
 * which would give a screen reader eight links per row all saying different
 * halves of the same thing. This is one link with one accessible name, and
 * anything that needs to sit above it (a button, an external link) raises
 * itself with `.ops-cell-top`.
 */
export function RowLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <Link href={href} className="ops-row-link" aria-label={label}>
        <span className="sr-only">{label}</span>
      </Link>
      {children}
    </>
  );
}

/**
 * Age in whole years from a YYYY-MM-DD string.
 *
 * Pure, and deliberately not a Date subtraction: `childRows` returns the
 * birthday as a string precisely so no timezone can shift it across midnight
 * and make a child a year younger in the office than at home.
 */
export function ageFrom(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number) as unknown as [string, number, number, number];

  const now = new Date();
  let age = now.getUTCFullYear() - y;
  const monthNow = now.getUTCMonth() + 1;
  const dayNow = now.getUTCDate();
  if (monthNow < mo || (monthNow === mo && dayNow < d)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}
