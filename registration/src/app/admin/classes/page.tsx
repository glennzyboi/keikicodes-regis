import { formatMoney } from "@/lib/stripe";
import { readAsStaff, classRows } from "../queries";
import { Icon, PageHead, Pill, when } from "../ui";
import { SessionControls } from "../session-controls";

export const dynamic = "force-dynamic";

export default async function Classes() {
  const { data: classes } = await readAsStaff((tx) => classRows(tx));

  const drift = classes.filter((c) => c.enrolled + c.held !== c.seats_taken);

  return (
    <div className="space-y-4">
      <PageHead
        title="Classes"
        note="Enrolled plus held must always equal seats taken. If it ever does not, the counter and the records have drifted, and that is a bug worth chasing rather than a number worth correcting by hand."
      />

      {drift.length > 0 && (
        <div className="ops-panel ops-enter p-4" style={{ borderColor: "var(--ops-danger)" }}>
          <p className="flex items-center gap-2 font-medium text-[var(--ops-danger)]">
            <Icon name="warning" />
            {drift.length} class{drift.length === 1 ? "" : "es"} do not reconcile
          </p>
          <p className="mt-1 text-[var(--ops-muted)]">
            {drift.map((c) => c.title).join(", ")}. The seat counter disagrees with the
            enrollments and holds behind it.
          </p>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {classes.map((c) => {
          const reconciles = c.enrolled + c.held === c.seats_taken;
          const pct = Math.round((c.seats_taken / c.capacity) * 100);
          const free = c.capacity - c.seats_taken;

          return (
            <section key={c.id} className="ops-panel ops-enter p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{c.title}</p>
                  <p className="ops-mono truncate">
                    {c.school} ·{" "}
                    {c.next_session_at
                      ? `next ${when(new Date(c.next_session_at), c.timezone)}`
                      : "term finished"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[17px] font-semibold">
                    {c.seats_taken}
                    <span className="text-[var(--ops-faint)]">/{c.capacity}</span>
                  </p>
                  <p className="ops-mono">{formatMoney(c.revenue_cents)} booked</p>
                </div>
              </div>

              <div
                className="ops-meter mt-3"
                data-tone={pct >= 100 ? "full" : undefined}
                role="img"
                aria-label={`${pct}% full`}
              >
                <span style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Pill tone="quiet">{c.enrolled} enrolled</Pill>
                <Pill tone="quiet">{c.held} held</Pill>
                <Pill tone={free === 0 ? "warn" : "good"}>
                  {free === 0 ? "full" : `${free} free`}
                </Pill>
                <Pill tone="quiet">{c.sessions_left} sessions left</Pill>
                {!reconciles && (
                  <Pill tone="danger">
                    <Icon name="warning" size={11} />
                    does not reconcile
                  </Pill>
                )}
              </div>

              {c.next_session_id && (
                <SessionControls
                  sessionId={c.next_session_id}
                  label={when(new Date(c.next_session_at!), c.timezone)}
                />
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
