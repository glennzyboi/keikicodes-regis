import Link from "next/link";
import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/staff-auth";
import { offerings } from "../queries";
import { EmptyState, Money, PageHead, Pill } from "../../ui";

export const dynamic = "force-dynamic";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`;
};

function statusTone(status: string) {
  if (status === "published") return "good" as const;
  if (status === "draft") return "warn" as const;
  return "quiet" as const;
}

/**
 * Every class, in one table the office can work from.
 *
 * The columns are the ones that get asked about on the phone: is it on, when
 * does it run, how full is it, what does it cost, and who takes the money.
 * Sorted with the current term first, because that is the only one anyone is
 * fielding calls about.
 */
export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  if (!(await currentStaff())) redirect("/admin/login");
  const { q } = await searchParams;

  const all = await offerings();
  const needle = (q ?? "").trim().toLowerCase();
  const list = needle
    ? all.filter((o) =>
        [o.title, o.school, o.program, o.term].some((v) => v.toLowerCase().includes(needle)),
      )
    : all;

  const sellable = all.filter((o) => o.registrationMode === "keiki_coders");
  const seats = sellable.reduce((n, o) => n + o.seatsLeft, 0);

  return (
    <>
      <PageHead
        title="Classes"
        note={`${all.length} across ${new Set(all.map((o) => o.school)).size} campuses. ${sellable.length} take registrations here, with ${seats} seats free. The rest are enrolled by the school.`}
      />

      <form className="mt-4 flex gap-2" action="/admin/catalogue/classes">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Class, campus, program or term"
          className="ops-field w-full max-w-md"
          aria-label="Search classes"
        />
        <button className="ops-btn">Search</button>
        {needle && (
          <Link href="/admin/catalogue/classes" className="ops-btn">
            Clear
          </Link>
        )}
      </form>

      <div className="ops-panel mt-4">
        {list.length === 0 ? (
          <EmptyState
            icon="book"
            title="No classes match"
            note="Try a campus name, or clear the search."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Campus</th>
                  <th>When</th>
                  <th>Grades</th>
                  <th className="ops-num">Sessions</th>
                  <th className="ops-num">Filled</th>
                  <th className="ops-num">Price</th>
                  <th>Registration</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((o) => {
                  const pct = o.capacity > 0 ? Math.round((o.seatsTaken / o.capacity) * 100) : 0;
                  return (
                    <tr key={o.id}>
                      <td>
                        <Link
                          href={`/admin/catalogue/classes/${o.id}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {o.title}
                        </Link>
                        <div className="text-[var(--ops-muted)]">{o.term}</div>
                      </td>
                      <td>{o.school}</td>
                      <td className="whitespace-nowrap">
                        {DAY[o.weekday]} {clock(o.startTime)}
                      </td>
                      <td>{o.gradeLabel ?? "any"}</td>
                      <td className="ops-num">
                        {o.sessionCount}
                        {o.cancelledCount > 0 && (
                          <span className="text-[var(--ops-muted)]"> +{o.cancelledCount}</span>
                        )}
                      </td>
                      <td className="ops-num">
                        {o.registrationMode === "external" ? (
                          <span className="text-[var(--ops-faint)]">n/a</span>
                        ) : (
                          <>
                            {o.seatsTaken}/{o.capacity}
                            <div className="ops-meter mt-1">
                              <span style={{ width: `${Math.min(pct, 100)}%` }} />
                            </div>
                          </>
                        )}
                      </td>
                      <td className="ops-num">
                        {o.priceCents === null ? (
                          <span className="text-[var(--ops-faint)]">n/a</span>
                        ) : (
                          <Money cents={o.priceCents} />
                        )}
                      </td>
                      <td>
                        {o.registrationMode === "external" ? (
                          <Pill tone="quiet">School</Pill>
                        ) : (
                          <Pill tone="info">Keiki Coders</Pill>
                        )}
                      </td>
                      <td>
                        <Pill tone={statusTone(o.status)}>{o.status}</Pill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
