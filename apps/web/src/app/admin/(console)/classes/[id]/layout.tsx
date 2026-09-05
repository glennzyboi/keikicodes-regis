import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney } from "@keiki/core/money";
import { readAsStaff } from "@/app/admin/queries";
import { classHeader } from "@/app/admin/class-queries";
import { Icon, Pill, when } from "@/app/admin/ui";
import { ClassTabs } from "./tabs";

export const dynamic = "force-dynamic";

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function clock(t: string) {
  const [h, m] = t.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`;
}

/**
 * One class, with the identity of the thing you are working on always on screen.
 *
 * The header is in the layout rather than repeated on each tab for a reason
 * beyond tidiness: it does not re-render when you move between tabs, so the
 * picture, the campus and the fill meter stay put instead of flashing. Which
 * class you are editing is the single most important fact on the page and the
 * easiest one to lose track of, since several campuses run classes with
 * identical titles.
 */
export default async function ClassLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data: c } = await readAsStaff((tx) => classHeader(tx, id));
  if (!c) notFound();

  const external = c.registration_mode === "external";
  const pct = c.capacity > 0 ? Math.round((c.seats_taken / c.capacity) * 100) : 0;
  const reconciles = c.enrolled + c.held === c.seats_taken;

  return (
    <div className="space-y-4">
      <Link href="/admin/classes" className="ops-mono inline-flex items-center gap-1">
        &larr; All classes
      </Link>

      <div className="ops-panel ops-enter ops-classhead">
        <div className="ops-classhead-art" data-empty={c.program_image_url ? undefined : "true"}>
          {c.program_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.program_image_url} alt="" />
          ) : (
            <span aria-hidden>{c.program.slice(0, 1)}</span>
          )}
        </div>

        <div className="ops-classhead-body">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              {/* `.ops-label` is display:block so it can caption a field, which
                  means it cannot also be the flex row here. The row is its own
                  element and the label styling sits on the text inside it. */}
              <div className="flex items-center gap-2">
                {c.school_logo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.school_logo_url} alt="" className="ops-classhead-logo" />
                )}
                <span className="ops-label">{c.school}</span>
                <span className="ops-label text-[var(--ops-faint)]">{c.term}</span>
              </div>
              <h1 className="mt-1 text-[21px] font-semibold">{c.title}</h1>
              <p className="mt-1 text-[var(--ops-muted)]">
                {DAY[c.weekday]}s {clock(c.start_time)} to {clock(c.end_time)}
                {c.location ? ` · ${c.location}` : ""} · Grades {c.grade_label ?? "any"}
                {c.price_cents !== null ? ` · ${formatMoney(c.price_cents)}` : ""}
              </p>
              <p className="mt-1 text-[var(--ops-muted)]">
                {c.next_session_at
                  ? `Next session ${when(new Date(c.next_session_at), c.timezone)}`
                  : "No sessions left this term"}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {c.status !== "published" && <Pill tone="warn">{c.status}</Pill>}
              {!reconciles && (
                <Pill tone="danger">
                  <Icon name="warning" size={11} />
                  does not reconcile
                </Pill>
              )}
              {!external && (
                <Link href={`/register/${c.id}`} target="_blank" className="ops-btn">
                  View as a parent
                </Link>
              )}
            </div>
          </div>

          {external ? (
            <p className="mt-3 flex items-center gap-2 text-[var(--ops-muted)]">
              <Icon name="building" size={14} />
              This campus enrolls families itself, so there are no seats or payments here.
            </p>
          ) : (
            <div className="mt-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[var(--ops-muted)]">
                  <span className="font-semibold text-[var(--ops-text)]">
                    {c.seats_taken}/{c.capacity}
                  </span>{" "}
                  seats · {c.enrolled} enrolled · {c.held} held · {c.sessions_left} sessions left
                </p>
                <p className="ops-mono">{pct}%</p>
              </div>
              <div className="ops-meter mt-1.5" data-tone={pct >= 100 ? "full" : undefined}>
                <span style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>

      <ClassTabs id={id} />

      {children}
    </div>
  );
}
