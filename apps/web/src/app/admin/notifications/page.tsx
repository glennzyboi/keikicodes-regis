import Link from "next/link";
import { readAsStaff, notificationRows } from "../queries";
import { EmptyState, PageHead, Pill, Stat, when } from "../ui";
import { requeueNotification, cancelNotification } from "../actions";

export const dynamic = "force-dynamic";

/**
 * The outbox.
 *
 * Every message the system has decided to send, and what became of it. This
 * exists because "did the Tuesday parents get the holiday notice?" is a
 * question the office asks out loud, and answering it should not mean logging
 * into a third party dashboard and searching by address.
 */
export default async function Notifications({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const { data: rows } = await readAsStaff((tx) =>
    notificationRows(tx, { status, limit: 200 }),
  );

  const { data: all } = await readAsStaff((tx) => notificationRows(tx, { limit: 500 }));
  const counts = {
    queued: all.filter((r) => r.status === "queued").length,
    sent: all.filter((r) => r.status === "sent").length,
    failed: all.filter((r) => r.status === "failed").length,
  };

  const filters = [
    { key: undefined, label: "All" },
    { key: "queued", label: "Queued" },
    { key: "sent", label: "Sent" },
    { key: "failed", label: "Failed" },
  ];

  return (
    <div className="space-y-4">
      <PageHead
        title="Outbox"
        note="Messages are written to the database inside the transaction that caused them, then delivered by a worker. That is why a cancelled class and the email about it can never disagree, and why a provider outage delays mail rather than losing it."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          icon="clock"
          tint={counts.queued > 0 ? "warn" : "good"}
          label="Waiting to send"
          value={String(counts.queued)}
          note="picked up by the worker on its next pass"
        />
        <Stat icon="check" tint="good" label="Delivered" value={String(counts.sent)} />
        <Stat
          icon="warning"
          tint={counts.failed > 0 ? "danger" : "good"}
          label="Failed"
          value={String(counts.failed)}
          note={counts.failed > 0 ? "retried five times, then parked" : "none"}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <Link
            key={f.label}
            href={f.key ? `/admin/notifications?status=${f.key}` : "/admin/notifications"}
            className="ops-btn"
            data-chosen={status === f.key}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <section className="ops-panel ops-enter">
        <div className="ops-panel-head">
          <h2 className="text-[15px] font-semibold">
            Messages
            <span className="ops-pill ops-pill-quiet ml-2 align-middle">{rows.length}</span>
          </h2>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon="mail"
            title="Nothing here"
            note={
              status
                ? "No messages in that state."
                : "Nothing has been queued yet. Registering, cancelling a session or running the reminder job will fill this."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Message</th>
                  <th>To</th>
                  <th>About</th>
                  <th>When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => (
                  <tr key={n.id}>
                    <td>
                      <Pill
                        tone={
                          n.status === "sent"
                            ? "good"
                            : n.status === "failed"
                              ? "danger"
                              : n.status === "queued"
                                ? "warn"
                                : "quiet"
                        }
                      >
                        {n.status}
                      </Pill>
                      {n.attempts > 1 && (
                        <p className="ops-mono mt-1">{n.attempts} attempts</p>
                      )}
                    </td>
                    <td>
                      <p className="font-medium">{n.template.replace(/_/g, " ")}</p>
                      <p className="ops-mono truncate" style={{ maxWidth: 320 }}>
                        {n.subject ?? "renders at send time"}
                      </p>
                      {n.last_error && (
                        <p className="mt-1 text-[var(--ops-danger)]">{n.last_error}</p>
                      )}
                    </td>
                    <td>
                      <p className="ops-mono">{n.to_address}</p>
                      {n.parent_name && <p>{n.parent_name}</p>}
                    </td>
                    <td className="text-[var(--ops-muted)]">{n.class_title ?? "—"}</td>
                    <td className="text-[var(--ops-muted)]">
                      {n.sent_at
                        ? when(new Date(n.sent_at))
                        : `due ${when(new Date(n.scheduled_for))}`}
                    </td>
                    <td>
                      {n.status === "failed" && (
                        <form action={requeueNotification}>
                          <input type="hidden" name="notificationId" value={n.id} />
                          <button className="ops-btn">Try again</button>
                        </form>
                      )}
                      {n.status === "queued" && (
                        <form action={cancelNotification}>
                          <input type="hidden" name="notificationId" value={n.id} />
                          <button className="ops-btn">Stop</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
