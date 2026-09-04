import type { DayPoint } from "./queries";

/**
 * Fourteen days of registrations, drawn as SVG on the server.
 *
 * No charting library. This is one series of fourteen integers, and a chart
 * package would be more bytes over the wire than the entire rest of the page.
 * Server rendered means it arrives with the HTML rather than after a hydration
 * pass, which on an internal tool people reload all day is the difference
 * people actually feel.
 */
export function RegistrationsChart({ points }: { points: DayPoint[] }) {
  const w = 640;
  const h = 170;
  const padL = 26;
  const padR = 14;
  const padB = 22;
  const padT = 8;

  const max = Math.max(...points.map((p) => p.registrations), 4);
  // Round the axis up to something a human would pick.
  const top = Math.ceil(max / 4) * 4;

  const innerW = w - padL - padR;
  const innerH = h - padB - padT;
  const step = points.length > 1 ? innerW / (points.length - 1) : innerW;

  const xy = points.map((p, i) => {
    const x = padL + i * step;
    const y = padT + innerH - (p.registrations / top) * innerH;
    return [x, y] as const;
  });

  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${padL},${padT + innerH} ${line} ${(padL + innerW).toFixed(1)},${padT + innerH}`;

  const gridlines = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: padT + innerH - f * innerH,
    value: Math.round(top * f),
  }));

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        style={{ height: "auto" }}
        role="img"
        aria-label={`Registrations over the last ${points.length} days, peaking at ${max} in a day`}
      >
        <defs>
          <linearGradient id="regFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ops-accent)" stopOpacity="0.20" />
            <stop offset="100%" stopColor="var(--ops-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridlines.map((g) => (
          <g key={g.value}>
            <line
              x1={padL}
              x2={w}
              y1={g.y}
              y2={g.y}
              stroke="var(--ops-line-soft)"
              strokeWidth="1"
            />
            <text
              x={padL - 7}
              y={g.y + 3.5}
              textAnchor="end"
              fontSize="10"
              fill="var(--ops-faint)"
            >
              {g.value}
            </text>
          </g>
        ))}

        <polygon points={area} fill="url(#regFill)" />
        <polyline
          points={line}
          fill="none"
          stroke="var(--ops-accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {xy.map(([x, y], i) =>
          points[i].registrations > 0 ? (
            <circle key={i} cx={x} cy={y} r="2.6" fill="var(--ops-surface)" stroke="var(--ops-accent)" strokeWidth="1.8">
              <title>{`${label(points[i].day)}: ${points[i].registrations} registration${
                points[i].registrations === 1 ? "" : "s"
              }`}</title>
            </circle>
          ) : null,
        )}

        {points.map((p, i) =>
          // Label every third day, so fourteen ticks do not collide.
          i % 3 === 0 || i === points.length - 1 ? (
            <text
              key={p.day}
              x={padL + i * step}
              y={h - 5}
              textAnchor="middle"
              fontSize="10"
              fill="var(--ops-faint)"
            >
              {label(p.day)}
            </text>
          ) : null,
        )}
      </svg>
    </figure>
  );
}

function label(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}
