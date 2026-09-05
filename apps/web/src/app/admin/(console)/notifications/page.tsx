import { Suspense } from "react";
import {
  readAsStaff,
  notificationRows,
  notificationCounts,
  notificationTemplates,
  countOf,
  type NotificationFilters,
} from "@/app/admin/queries";
import { FilterBar } from "@/app/admin/filters";
import {
  EmptyState,
  PageHead,
  Pager,
  Pill,
  Stat,
  TableSkeleton,
  PER_PAGE,
  pageFrom,
  when,
} from "@/app/admin/ui";
import { requeueNotification, cancelNotification } from "@/app/admin/actions";

export const dynamic = "force-dynamic";

const STATUSES = [
  { value: "queued", label: "Waiting to send" },
  { value: "sending", label: "Sending" },
  { value: "sent", label: "Delivered" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Stopped" },
];

const CHANNELS = [{ value: "email", label: "Email" }];

/**
 * The outbox.
 *
 * In the System group now rather than under Comms, and the reframing is the
 * point. It reads like a queue somebody has to work, and it is not: it empties
 * itself, and a badge that never reaches zero teaches people to ignore badges.
 * This is a window onto what the machine is doing, and the only rows anybody
 * has to act on are the failed ones.
 *
 * It exists because "did the Tuesday parents get the holiday notice?" is a
 * question the office asks out loud, and answering it should not mean logging
 * into a third party dashboard and searching by address.
 */
export default async function Notifications({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const page = pageFrom(params.page);

  const { data: head } = await readAsStaff(async (tx) => ({
    counts: await notificationCounts(tx),
    templates: await notificationTemplates(tx),
  }));

  const filters: NotificationFilters = {
    search: params.q?.trim() || undefined,
    status: STATUSES.some((s) => s.value === params.status) ? params.status : undefined,
    template: head.templates.includes(params.template ?? "") ? params.template : undefined,
    channel: CHANNELS.some((c) => c.value === params.channel) ? params.channel : undefined,
  };

  const linkParams = {
    q: filters.search,
    status: filters.status,
    template: filters.template,
    channel: filters.channel,
  };

  return (
    <div className="space-y-4">
      <PageHead
        title="Outbox"
        note="Messages are written to the database inside the transaction that caused them, then delivered by a worker. That is why a cancelled class and the email about it can never disagree, and why a provider outage delays mail rather than losing it."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          icon="clock"
          tint={head.counts.queued > 0 ? "warn" : "good"}
          label="Waiting to send"
          value={String(head.counts.queued)}
          note="picked up by the worker on its next pass"
        />
        <Stat icon="check" tint="good" label="Delivered" value={String(head.counts.sent)} />
        <Stat
          icon="warning"
          tint={head.counts.failed > 0 ? "danger" : "good"}
          label="Failed"
          value={String(head.counts.failed)}
          note={head.counts.failed > 0 ? "retried five times, then parked" : "none"}
        />
      </div>

      <FilterBar
        basePath="/admin/notifications"
        search={{ value: params.q, placeholder: "Address or subject" }}
        selects={[
          {
            name: "status",
            label: "Status",
            value: filters.status,
            anyLabel: "Any status",
            options: STATUSES,
          },
          {
            name: "template",
            label: "Message",
            value: filters.template,
            anyLabel: "Every message",
            options: head.templates.map((t) => ({ value: t, label: t.replace(/_/g, " ") })),
          },
          {
            name: "channel",
            label: "Channel",
            value: filters.channel,
            anyLabel: "Any channel",
            options: CHANNELS,
          },
        ]}
      />

      <Suspense
        key={`${JSON.stringify(filters)}|${page}`}
        fallback={
          <div className="ops-panel">
            <TableSkeleton rows={PER_PAGE} cols={6} />
          </div>
        }
      >
        <Rows filters={filters} page={page} linkParams={linkParams} />
      </Suspense>
    </div>
  );
}

async function Rows({
  filters,
  page,
  linkParams,
}: {
  filters: NotificationFilters;
  page: number;
  linkParams: Record<string, string | undefined>;
}) {
  // One read, in one transaction, so the count and the rows describe the same
  // moment. This used to be two separate reads, the second of five hundred rows
  // purely to count them in JavaScript.
  const { data } = await readAsStaff(async (tx) => ({
    rows: await notificationRows(tx, { ...filters, page, perPage: PER_PAGE }),
    total: await countOf(tx, "notifications", filters),
  }));

  return (
    <section className="ops-panel ops-enter">
      <div className="ops-panel-head">
        <h2 className="text-[15px] font-semibold">
          Messages
          <span className="ops-pill ops-pill-quiet ml-2 align-middle">{data.total}</span>
        </h2>
      </div>

      {data.rows.length === 0 ? (
        <EmptyState
          icon="mail"
          title="Nothing here"
          note="No message matches those filters. Registering, cancelling a session or running the reminder job fills this."
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
              {data.rows.map((n) => (
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
                    {n.attempts > 1 && <p className="ops-mono mt-1">{n.attempts} attempts</p>}
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

      {/* Rows here carry inline "Try again" and "Stop" forms, so the row is
          deliberately not a link: one click cannot mean both. */}
      <Pager
        page={page}
        total={data.total}
        basePath="/admin/notifications"
        params={linkParams}
      />
    </section>
  );
}
