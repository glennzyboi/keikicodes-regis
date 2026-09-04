import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney } from "@keiki/core/stripe";
import { isUuid } from "@keiki/core/uuid";
import {
  readAsStaff,
  familyDetail,
  childRows,
  enrollmentRows,
  paymentRows,
  notificationRows,
  supportNotes,
} from "../../queries";
import { EmptyState, Icon, Pill, Stat, initials, refundTone, tintFor, when } from "../../ui";
import { AddNote } from "./add-note";
import { ResendNotification } from "./resend";
import { signPhotos } from "@/lib/photos";
import { ChildPhoto } from "../../child-photo";

export const dynamic = "force-dynamic";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * One family, everything about them, on one screen.
 *
 * This is the page the office lives on when the phone rings. Whoever picks up
 * needs the same four things every time: who is this, what are they signed up
 * for, what have they paid, and what have we already told them. Splitting those
 * across four tabs means four clicks while somebody waits on the line.
 */
export default async function Family({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { data } = await readAsStaff(async (tx) => ({
    family: (await familyDetail(tx, id))[0],
    children: await childRows(tx, { parentId: id }),
    enrollments: await enrollmentRows(tx, { parentId: id }),
    payments: await paymentRows(tx, { parentId: id }),
    messages: await notificationRows(tx, { parentId: id, limit: 25 }),
    notes: await supportNotes(tx, id),
  }));

  if (!data.family) notFound();

  // Signed for the whole family at once. The bucket is private, so a photo has
  // no URL until one is minted, and it stops working ten minutes later.
  const photos = await signPhotos(data.children.map((c) => c.photo_path));

  const f = data.family;
  const paid = data.payments
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + p.amount_cents, 0);
  const refunded = data.payments.reduce((s, p) => s + p.refunded_cents, 0);
  const active = data.enrollments.filter((e) => e.status !== "cancelled");
  const openIssues = data.enrollments.filter(
    (e) => e.status === "cancellation_requested" || e.refund_owed,
  );

  return (
    <div className="space-y-4">
      <Link href="/admin/families" className="ops-mono inline-flex items-center gap-1">
        &larr; All families
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className="ops-avatar"
            style={{ background: tintFor(f.email), width: 44, height: 44, fontSize: 15 }}
          >
            {initials(f.full_name)}
          </span>
          <div>
            <h1 className="text-[21px] font-semibold">{f.full_name}</h1>
            <p className="ops-mono">
              {f.email}
              {f.phone ? ` · ${f.phone}` : ""} · joined {when(new Date(f.created_at))}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {f.has_account ? <Pill tone="good">has account</Pill> : <Pill tone="warn">no account</Pill>}
          {openIssues.length > 0 && <Pill tone="warn">{openIssues.length} open</Pill>}
          <a className="ops-btn" href={`mailto:${f.email}`}>
            <Icon name="mail" size={14} />
            Email
          </a>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon="child" tint="accent" label="Keiki" value={String(data.children.length)} />
        <Stat icon="book" tint="violet" label="Active places" value={String(active.length)} />
        <Stat icon="cash" tint="good" label="Paid" value={formatMoney(paid)} />
        <Stat
          icon="undo"
          tint={refunded > 0 ? "warn" : "good"}
          label="Refunded"
          value={formatMoney(refunded)}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {/* ------------------------------------------------------ keiki */}
          <section className="ops-panel ops-enter">
            <div className="ops-panel-head">
              <h2 className="text-[15px] font-semibold">Keiki</h2>
              <span className="ops-pill ops-pill-quiet">{data.children.length}</span>
            </div>
            {data.children.length === 0 ? (
              <p className="px-4 py-5 text-[var(--ops-muted)]">No children on file yet.</p>
            ) : (
              <div>
                {data.children.map((c) => (
                  <div key={c.child_id} className="ops-row">
                    <ChildPhoto
                      name={`${c.first_name} ${c.last_name}`}
                      url={c.photo_path ? photos.get(c.photo_path) : null}
                      size={40}
                    />
                    <div className="min-w-0">
                      <p className="font-medium">
                        {c.first_name} {c.last_name}
                        {c.in_afterschool_care && (
                          <span className="ops-pill ops-pill-info ml-2">
                            {c.afterschool_care_program ?? "after school care"}
                          </span>
                        )}
                      </p>
                      <p className="ops-mono">
                        {c.grade === null
                          ? ""
                          : `${c.grade === 0 ? "Kindergarten" : `Grade ${c.grade}`} · `}
                        born {c.date_of_birth} · {c.enrollments} active
                      </p>
                      {/* Allergies and medical notes. The reason this system is
                          behind a password rather than a link in an inbox. */}
                      {c.notes && (
                        <p className="mt-1 rounded-md bg-[var(--ops-warn-soft)] px-2.5 py-1.5 text-[var(--ops-warn)]">
                          {c.notes}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ------------------------------------------------ enrollments */}
          <section className="ops-panel ops-enter">
            <div className="ops-panel-head">
              <h2 className="text-[15px] font-semibold">Registrations</h2>
              <span className="ops-pill ops-pill-quiet">{data.enrollments.length}</span>
            </div>
            {data.enrollments.length === 0 ? (
              <EmptyState icon="book" title="Nothing registered" note="This family has not booked a class yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Child</th>
                      <th>Class</th>
                      <th>When</th>
                      <th className="ops-num">Paid</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.enrollments.map((e) => (
                      <tr key={e.enrollment_id}>
                        <td className="font-medium">{e.child_name}</td>
                        <td>
                          <Link
                            href={`/admin/classes/${e.class_offering_id}`}
                            className="underline decoration-dotted underline-offset-2"
                          >
                            {e.title}
                          </Link>
                          <p className="ops-mono">{e.school}</p>
                        </td>
                        <td className="text-[var(--ops-muted)]">
                          {DAYS[e.weekday]} {e.start_time.slice(0, 5)}
                        </td>
                        <td className="ops-num">{formatMoney(e.price_cents)}</td>
                        <td>
                          <div className="flex flex-wrap gap-1.5">
                            {e.status === "active" && <Pill tone="good">enrolled</Pill>}
                            {e.status === "cancellation_requested" && (
                              <Pill tone="warn">cancellation asked</Pill>
                            )}
                            {e.status === "cancelled" && <Pill tone="quiet">cancelled</Pill>}
                            {e.joined_late && <Pill tone="info">joined mid term</Pill>}
                            {e.refund_owed && <Pill tone="warn">refund owed</Pill>}
                            {e.refund_status && (
                              <Pill tone={refundTone(e.refund_status)}>{e.refund_status}</Pill>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* --------------------------------------------------- payments */}
          <section className="ops-panel ops-enter">
            <div className="ops-panel-head">
              <h2 className="text-[15px] font-semibold">Payment history</h2>
              <span className="ops-pill ops-pill-quiet">{data.payments.length}</span>
            </div>
            {data.payments.length === 0 ? (
              <p className="px-4 py-5 text-[var(--ops-muted)]">No orders yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>For</th>
                      <th className="ops-num">Amount</th>
                      <th className="ops-num">Refunded</th>
                      <th>Status</th>
                      <th>Stripe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((p) => (
                      <tr key={p.order_id}>
                        <td className="text-[var(--ops-muted)]">{when(new Date(p.created_at))}</td>
                        <td>{p.classes.join(", ")}</td>
                        <td className="ops-num font-medium">{formatMoney(p.amount_cents)}</td>
                        <td className="ops-num">
                          {p.refunded_cents > 0 ? formatMoney(p.refunded_cents) : "—"}
                        </td>
                        <td>
                          <Pill
                            tone={
                              p.status === "paid" ? "good" : p.status === "pending" ? "warn" : "quiet"
                            }
                          >
                            {p.status}
                          </Pill>
                        </td>
                        <td>
                          {p.payment_intent ? (
                            <a
                              className="ops-mono underline decoration-dotted underline-offset-2"
                              href={`https://dashboard.stripe.com/test/payments/${p.payment_intent}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              open
                            </a>
                          ) : (
                            <span className="ops-mono">—</span>
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

        <div className="space-y-4">
          {/* ------------------------------------------------------ notes */}
          <section className="ops-panel ops-enter">
            <div className="ops-panel-head">
              <div>
                <h2 className="text-[15px] font-semibold">Office notes</h2>
                <p className="mt-0.5 text-[var(--ops-muted)]">
                  What was said, so the next person to answer knows
                </p>
              </div>
            </div>
            <div className="border-b border-[var(--ops-line)] p-4">
              <AddNote parentId={f.parent_id} keiki={data.children} />
            </div>
            {data.notes.length === 0 ? (
              <p className="px-4 py-5 text-[var(--ops-muted)]">
                Nothing logged. Notes are append only, so a correction is another note.
              </p>
            ) : (
              <div>
                {data.notes.map((n) => (
                  <div key={n.id} className="ops-feed-item">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill tone={n.kind === "complaint" ? "danger" : n.kind === "resolved" ? "good" : "quiet"}>
                          {n.kind}
                        </Pill>
                        {n.child_name && <span className="ops-mono">{n.child_name}</span>}
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap">{n.body}</p>
                      <p className="ops-mono mt-1">
                        {n.author_email} · {when(new Date(n.created_at))}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* --------------------------------------------------- messages */}
          <section className="ops-panel ops-enter">
            <div className="ops-panel-head">
              <div>
                <h2 className="text-[15px] font-semibold">What we sent them</h2>
                <p className="mt-0.5 text-[var(--ops-muted)]">
                  Answers &quot;did you email me about that?&quot; without opening Resend
                </p>
              </div>
            </div>
            {data.messages.length === 0 ? (
              <p className="px-4 py-5 text-[var(--ops-muted)]">Nothing sent yet.</p>
            ) : (
              <div>
                {data.messages.map((m) => (
                  <div key={m.id} className="ops-feed-item">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill
                          tone={
                            m.status === "sent"
                              ? "good"
                              : m.status === "failed"
                                ? "danger"
                                : m.status === "queued"
                                  ? "warn"
                                  : "quiet"
                          }
                        >
                          {m.status}
                        </Pill>
                        <span className="ops-mono">{m.template.replace(/_/g, " ")}</span>
                      </div>
                      <p className="mt-1 truncate">{m.subject ?? "not rendered yet"}</p>
                      <p className="ops-mono">
                        {m.sent_at ? when(new Date(m.sent_at)) : `queued ${when(new Date(m.created_at))}`}
                        {m.attempts > 1 ? ` · ${m.attempts} attempts` : ""}
                      </p>
                      {m.last_error && (
                        <p className="mt-1 text-[var(--ops-danger)]">{m.last_error}</p>
                      )}
                      {m.status === "failed" && <ResendNotification id={m.id} />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
