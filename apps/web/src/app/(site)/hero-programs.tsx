import Link from "next/link";

/**
 * What the hero shows: the actual classes running this term.
 *
 * This replaced an animated mascot. The mascot was theirs and it was charming,
 * and it was answering the wrong question. Somebody landing on this page is
 * deciding whether there is something here for their child, and the fastest
 * possible answer to that is four real classes with real photographs, real
 * campuses and real seat counts, rather than a turtle doing a stroke.
 *
 * Every one of these is live: the picture is the program's own, the seats come
 * from the same counter the registration path decrements, and clicking one goes
 * to that class. A hero that is also the first step of the journey is worth more
 * than a hero that is decoration above it.
 *
 * The mascot still exists and still moves, on the sign in screen and in the
 * social cut of the film. It just is not what a parent needs in the first two
 * seconds.
 */

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function clock(t: string) {
  const [h, m] = t.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""}${h >= 12 ? "pm" : "am"}`;
}

export type HeroClass = {
  id: string;
  title: string;
  school: string;
  track: string | null;
  image_url: string | null;
  weekday: number;
  start_time: string;
  seats_left: number;
};

export function HeroPrograms({ classes }: { classes: HeroClass[] }) {
  if (classes.length === 0) return null;

  return (
    <div className="kc-hero-grid">
      {classes.map((c, i) => (
        <Link
          key={c.id}
          href={`/programs/${c.id}`}
          className="kc-hero-card"
          // A gentle stagger so it reads as a handful of cards rather than a
          // table. Index based rather than random, so the server and the client
          // agree and nothing shifts on hydration.
          style={{ "--i": i } as React.CSSProperties}
        >
          <span className="kc-hero-art" data-empty={c.image_url ? undefined : "true"}>
            {c.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.image_url} alt="" loading="eager" />
            ) : (
              <span aria-hidden>{c.title.slice(0, 1)}</span>
            )}
            {c.seats_left > 0 && c.seats_left <= 4 && (
              <span className="kc-hero-flag">{c.seats_left} left</span>
            )}
          </span>

          <span className="kc-hero-body">
            {c.track && <span className="kc-hero-track">{c.track}</span>}
            <span className="kc-hero-title">{c.title}</span>
            <span className="kc-hero-meta">
              {c.school} · {DAY[c.weekday]} {clock(c.start_time)}
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}
