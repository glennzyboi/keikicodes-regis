/**
 * Loading states for the parent site.
 *
 * A skeleton rather than a spinner, for the same reason as in the console: a
 * spinner says "something is happening", a skeleton says "a page shaped like
 * this is arriving", and the second one stops the layout jumping when it does.
 *
 * Shaped like the page it stands in for, not like a generic card. A grid of
 * three identical grey rectangles where four class cards are about to appear is
 * worse than nothing, because the page moves anyway.
 *
 * All of it is `aria-hidden` with one polite "Loading" for a screen reader.
 * Twenty empty boxes announced individually is noise.
 */

export function Bar({
  w = "100%",
  h = 14,
  className = "",
}: {
  w?: string | number;
  h?: number;
  className?: string;
}) {
  return <span className={`kc-skel ${className}`} style={{ width: w, height: h }} />;
}

/** A stand-in for one class card, at the height a real one settles at. */
export function CardSkeleton() {
  return (
    <div className="kc-tile" aria-hidden>
      <div className="kc-tile-top">
        <Bar w={42} h={42} className="rounded-2xl" />
        <Bar w={78} h={22} className="rounded-full" />
      </div>
      <div className="kc-tile-body">
        <Bar w="85%" h={20} />
        <Bar w="60%" h={20} className="mt-2" />
        <Bar w="100%" h={12} className="mt-4" />
        <Bar w="70%" h={12} className="mt-1.5" />
        <div className="kc-tile-facts">
          <Bar w={82} h={22} className="rounded-full" />
          <Bar w={70} h={22} className="rounded-full" />
          <Bar w={90} h={22} className="rounded-full" />
        </div>
      </div>
      <div className="kc-tile-foot">
        <Bar w={90} h={26} />
        <span className="kc-tile-cta">
          <Bar w={104} h={38} className="rounded-full" />
        </span>
      </div>
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <>
      <span className="sr-only" role="status">
        Loading
      </span>
      <div className="grid items-start gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: count }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </>
  );
}

export function HeadingSkeleton() {
  return (
    <div aria-hidden>
      <Bar w={110} h={26} className="rounded-full" />
      <Bar w="60%" h={40} className="mt-5" />
      <Bar w="45%" h={40} className="mt-2" />
      <Bar w="80%" h={16} className="mt-6" />
      <Bar w="70%" h={16} className="mt-2" />
    </div>
  );
}
