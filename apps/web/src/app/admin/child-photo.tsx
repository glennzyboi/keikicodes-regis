import { initials, tintFor } from "./ui";

/**
 * A child, as an instructor needs to recognise them.
 *
 * Their form requires a head shot and their office keeps it, so ours has to
 * show it or the requirement is theatre. The URL is signed on the server and
 * expires; if it is missing, or storage is having a bad day, this falls back to
 * initials rather than a broken image, because a roster that renders is worth
 * more than one that is perfectly illustrated.
 */
export function ChildPhoto({
  name,
  url,
  size = 32,
}: {
  name: string;
  url?: string | null;
  size?: number;
}) {
  if (!url) {
    return (
      <span
        className="ops-avatar"
        style={{ background: tintFor(name), width: size, height: size, fontSize: size * 0.36 }}
        aria-hidden
      >
        {initials(name)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className="ops-avatar object-cover"
      style={{ width: size, height: size }}
      loading="lazy"
    />
  );
}
