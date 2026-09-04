"use client";

import Link from "next/link";
import { formatMoney } from "@keiki/core/money";
import { ExpandableRow, Facts, Fact } from "@/components/expandable";
import type { PaymentRow } from "../queries";

/**
 * One order in the ledger, with the detail folded away.
 *
 * The summary carries what you scan by: who, how much, and whether it settled.
 * Everything you only want once you have found the right row lives inside.
 */
export function PaymentRowDetail({ payment: p }: { payment: PaymentRow }) {
  const net = p.amount_cents - p.refunded_cents;

  return (
    <ExpandableRow
      columns={2}
      summary={
        <span className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block font-medium">{p.parent_name}</span>
            <span className="ops-mono block truncate">
              {p.classes.join(", ")} · {when(p.created_at)}
            </span>
          </span>
          <span className="flex items-center gap-2.5">
            {p.refunded_cents > 0 && (
              <span className="ops-pill ops-pill-warn">
                {formatMoney(p.refunded_cents)} back
              </span>
            )}
            <span
              className={`ops-pill ops-pill-${
                p.status === "paid" ? "good" : p.status === "pending" ? "warn" : "quiet"
              }`}
            >
              {p.status}
            </span>
            <span className="font-semibold">{formatMoney(p.amount_cents)}</span>
          </span>
        </span>
      }
      detail={
        <Facts>
          <Fact label="Family">
            <Link
              href={`/admin/families/${p.parent_id}`}
              className="underline decoration-dotted underline-offset-2"
            >
              {p.parent_name}
            </Link>
            <span className="ops-mono block">{p.email}</span>
          </Fact>
          <Fact label="Classes">{p.classes.join(", ")}</Fact>
          <Fact label="Items">
            {p.items} {p.items === 1 ? "child" : "children"}
          </Fact>
          <Fact label="Charged">{formatMoney(p.amount_cents)}</Fact>
          <Fact label="Refunded">
            {p.refunded_cents > 0 ? formatMoney(p.refunded_cents) : "Nothing"}
          </Fact>
          <Fact label="Net">{formatMoney(net)}</Fact>
          <Fact label="Taken">{when(p.created_at)}</Fact>
          <Fact label="Confirmed">
            {p.fulfilled_at ? when(p.fulfilled_at) : "Not yet"}
          </Fact>
          <Fact label="Stripe">
            {p.payment_intent ? (
              <a
                className="ops-mono underline decoration-dotted underline-offset-2"
                href={`https://dashboard.stripe.com/test/payments/${p.payment_intent}`}
                target="_blank"
                rel="noreferrer"
              >
                {p.payment_intent}
              </a>
            ) : (
              <span className="ops-mono">none recorded</span>
            )}
          </Fact>
          <Fact label="Order id">
            <span className="ops-mono">{p.order_id}</span>
          </Fact>
        </Facts>
      }
    />
  );
}

function when(d: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Pacific/Honolulu",
  }).format(new Date(d));
}
