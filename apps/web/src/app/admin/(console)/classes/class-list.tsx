import Link from "next/link";
import { formatMoney } from "@keiki/core/money";
import { readAsStaff } from "@/app/admin/queries";
import {
  classList,
  classListCount,
  type ClassFilters,
  type ClassListRow,
  type ClassSort,
} from "@/app/admin/class-queries";
import {
  EmptyState,
  Icon,
  Pager,
  Pill,
  RowLink,
  Skeleton,
  SortHeader,
  PER_PAGE,
  type SortDir,
} from "@/app/admin/ui";

/**
 * The class list, rendered the same way wherever you came in from.
 *
 * `/admin/classes`, a campus page and a program page all render this component
 * with a different filter already applied. That is the whole answer to "the
 * catalogue and the rosters are the same thing twice": there is one list, and
 * the other pages are entrances to it rather than copies of it. Nothing can
 * drift, because there is nothing to keep in step.
 *
 * Two views on one URL. Cards are the default because a class is a thing with a
 * picture, a campus and a fill level, and a person scanning for "which Wai'alae
 * class still has room" reads that in one pass off a card and in four off a row.
 * The table is there for when the question is comparative ("which are the most
 * expensive"), because that is what a table is genuinely better at, and it
 * sorts. Neither is a lesser version of the other.
 */

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function clock(t: string) {
  const [h, m] = t.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""}${h >= 12 ? "pm" : "am"}`;
}

function statusTone(status: string) {
  if (status === "published") return "good" as const;
  if (status === "draft") return "warn" as const;
  return "quiet" as const;
}

export type ClassListView = "cards" | "table";

export async function ClassList({
  filters,
  view,
  page,
  sort,
  dir,
  basePath,
  linkParams,
}: {
  filters: ClassFilters;
  view: ClassListView;
  page: number;
  sort: ClassSort;
  dir: SortDir;
  basePath: string;
  /** Carried onto sort and pager links so a filter survives them. */
  linkParams: Record<string, string | undefined>;
}) {
  const { data } = await readAsStaff(async (tx) => ({
    rows: await classList(tx, filters, { page, perPage: PER_PAGE, sort, dir }),
    total: await classListCount(tx, filters),
  }));

  if (data.total === 0) {
    return (
      <div className="ops-panel ops-enter">
        <EmptyState
          icon="layers"
          title="No classes match"
          note="Nothing in the catalogue fits those filters. Take a chip off above, or widen the term."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {view === "cards" ? (
        <div className="ops-cards">
          {data.rows.map((c) => (
            <ClassCard key={c.id} c={c} />
          ))}
        </div>
      ) : (
        <div className="ops-panel ops-enter">
          <div className="overflow-x-auto">
            <table className="ops-table">
              <thead>
                <tr>
                  <SortHeader label="Class" column="title" current={sort} dir={dir} basePath={basePath} params={linkParams} />
                  <SortHeader label="Campus" column="campus" current={sort} dir={dir} basePath={basePath} params={linkParams} />
                  <SortHeader label="When" column="when" current={sort} dir={dir} basePath={basePath} params={linkParams} />
                  <th>Grades</th>
                  <SortHeader label="Filled" column="filled" current={sort} dir={dir} basePath={basePath} params={linkParams} numeric />
                  <SortHeader label="Price" column="price" current={sort} dir={dir} basePath={basePath} params={linkParams} numeric />
                  <th>Registration</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((c) => (
                  <ClassRow key={c.id} c={c} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="ops-panel ops-enter">
        <Pager page={page} total={data.total} basePath={basePath} params={linkParams} />
      </div>
    </div>
  );
}

function fill(c: ClassListRow) {
  const external = c.registration_mode === "external";
  const pct = c.capacity > 0 ? Math.round((c.seats_taken / c.capacity) * 100) : 0;
  const free = Math.max(0, c.capacity - c.seats_taken);
  const reconciles = c.enrolled + c.held === c.seats_taken;
  return { external, pct, free, reconciles };
}

function ClassCard({ c }: { c: ClassListRow }) {
  const { external, pct, free, reconciles } = fill(c);

  return (
    <article className="ops-card">
      {/*
        One stretched link over the whole card rather than a link on the title.
        A card is a single object and clicking anywhere on it should open it,
        which is what everybody tries first; making only the four words of the
        title live is the kind of thing people quietly work around by clicking
        three times.
      */}
      <Link href={`/admin/classes/${c.id}`} className="ops-card-link" aria-label={`${c.title} at ${c.school}`}>
        <span className="sr-only">
          {c.title} at {c.school}
        </span>
      </Link>

      <div className="ops-card-art" data-empty={c.program_image_url ? undefined : "true"}>
        {c.program_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.program_image_url} alt="" loading="lazy" />
        ) : (
          <span aria-hidden>{c.program.slice(0, 1)}</span>
        )}
        <span className="ops-card-campus" title={c.school}>
          {c.school_logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.school_logo_url} alt="" loading="lazy" />
          ) : (
            <span aria-hidden>{c.school.slice(0, 1)}</span>
          )}
        </span>
        {c.status !== "published" && (
          <span className="ops-card-status">
            <Pill tone={statusTone(c.status)}>{c.status}</Pill>
          </span>
        )}
      </div>

      <div className="ops-card-body">
        <div className="min-w-0">
          <p className="ops-card-title">{c.title}</p>
          <p className="ops-card-meta">
            {c.school} · {DAY_SHORT[c.weekday]} {clock(c.start_time)}–{clock(c.end_time)}
          </p>
        </div>

        <div className="ops-card-tags">
          {c.track && <Pill tone="quiet">{c.track}</Pill>}
          <Pill tone="quiet">Grades {c.grade_label ?? "any"}</Pill>
          {c.price_cents !== null && <Pill tone="quiet">{formatMoney(c.price_cents)}</Pill>}
        </div>

        {external ? (
          <p className="ops-card-external">
            <Icon name="building" size={13} />
            Enrolled by the campus, not here
          </p>
        ) : (
          <div>
            <div
              className="ops-meter"
              data-tone={pct >= 100 ? "full" : undefined}
              role="img"
              aria-label={`${pct}% full`}
            >
              <span style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
            <p className="ops-card-fill">
              <span className="font-semibold text-[var(--ops-text)]">
                {c.seats_taken}/{c.capacity}
              </span>{" "}
              seats · {free === 0 ? "full" : `${free} free`} · {c.sessions_left} sessions left
              {!reconciles && (
                <>
                  {" · "}
                  <span className="text-[var(--ops-danger)]">does not reconcile</span>
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </article>
  );
}

function ClassRow({ c }: { c: ClassListRow }) {
  const { external, pct } = fill(c);

  return (
    <tr>
      <td>
        <RowLink href={`/admin/classes/${c.id}`} label={`${c.title} at ${c.school}`}>
          <p className="font-medium">{c.title}</p>
          <p className="ops-mono">{c.term}</p>
        </RowLink>
      </td>
      <td>{c.school}</td>
      <td className="whitespace-nowrap">
        {DAY[c.weekday].slice(0, 3)} {clock(c.start_time)}
      </td>
      <td>{c.grade_label ?? "any"}</td>
      <td className="ops-num">
        {external ? (
          <span className="text-[var(--ops-faint)]">n/a</span>
        ) : (
          <>
            {c.seats_taken}/{c.capacity}
            <div className="ops-meter mt-1" data-tone={pct >= 100 ? "full" : undefined}>
              <span style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
          </>
        )}
      </td>
      <td className="ops-num">
        {c.price_cents === null ? (
          <span className="text-[var(--ops-faint)]">n/a</span>
        ) : (
          formatMoney(c.price_cents)
        )}
      </td>
      <td>
        <Pill tone={external ? "quiet" : "info"}>{external ? "Campus" : "Keiki Coders"}</Pill>
      </td>
      <td>
        <Pill tone={statusTone(c.status)}>{c.status}</Pill>
      </td>
    </tr>
  );
}

/**
 * What the list looks like while it is arriving.
 *
 * Shaped like the view it is standing in for, because the point of a skeleton
 * over a spinner is that nothing jumps when the real thing lands. This is what
 * makes a filter change feel instant: the rows are replaced the moment you
 * touch a dropdown rather than three hundred milliseconds later.
 */
export function ClassListSkeleton({ view }: { view: ClassListView }) {
  if (view === "table") {
    return (
      <div className="ops-panel" aria-hidden>
        {/* See TableSkeleton: a skeleton must not answer to .ops-table while it
            shares the document with the real rows during streaming. */}
        <table className="ops-skel-table">
          <tbody>
            {Array.from({ length: PER_PAGE }, (_, r) => (
              <tr key={r}>
                {Array.from({ length: 8 }, (_, c) => (
                  <td key={c}>
                    <Skeleton w={["70%", "45%", "85%", "35%", "60%", "50%"][(r + c) % 6]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="ops-cards" aria-hidden>
      {Array.from({ length: PER_PAGE }, (_, i) => (
        <div key={i} className="ops-card">
          <div className="ops-card-art ops-skel" />
          <div className="ops-card-body">
            <Skeleton w="72%" h={13} />
            <Skeleton w="52%" h={10} />
            <Skeleton w="88%" h={18} />
            <Skeleton w="100%" h={6} />
          </div>
        </div>
      ))}
    </div>
  );
}
