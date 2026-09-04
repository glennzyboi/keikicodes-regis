import { formatMoney } from "@/lib/money";

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
  check: <path d="m4 12.5 5 5L20 6.5" />,
  up: <path d="M12 19V5m0 0-6 6m6-6 6 6" />,
  down: <path d="M12 5v14m0 0 6-6m-6 6-6-6" />,
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
