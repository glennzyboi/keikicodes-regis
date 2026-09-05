import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * None of these are exotic. They are the set that costs nothing and closes the
 * cheap attacks, and their absence is the sort of thing a security review finds
 * in the first five minutes.
 *
 * There is deliberately no Content-Security-Policy here. A CSP that is wrong is
 * worse than none, because it either breaks the app or lulls you into thinking
 * you have one, and Next injects inline scripts whose nonces have to be threaded
 * through middleware to do it properly. That is a real task with a real test
 * pass, not a config line, so it is listed as work rather than faked.
 */
const securityHeaders = [
  // Do not let a browser guess that an uploaded .txt is really a script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // No framing at all. This app has no legitimate embedder, and clickjacking a
  // "cancel my registration" button is a real thing to prevent.
  { key: "X-Frame-Options", value: "DENY" },
  // Send the origin to third parties, never the full path. Paths here contain
  // family and class ids.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // We ask for none of these, so say so.
  //
  // `payment` is the exception and it has to be, now that checkout is embedded.
  // The Payment Request API is what puts Apple Pay and Google Pay in Stripe's
  // iframe, and `payment=()` denies it to every descendant frame. The failure is
  // silent: the card form still works perfectly, the wallet buttons simply never
  // appear, and a card-only test never notices. On a phone, where the wallet is
  // most of the conversion, that is an expensive thing to lose quietly. Granted
  // to this origin and to Stripe's, and to nothing else.
  {
    key: "Permissions-Policy",
    value:
      'camera=(), microphone=(), geolocation=(), usb=(), payment=(self "https://checkout.stripe.com" "https://js.stripe.com")',
  },
  // HSTS is only meaningful over TLS, which local development is not. Kept
  // because the deployment target is HTTPS and forgetting it there is worse.
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  // The domain lives in a sibling workspace package and ships as TypeScript
  // source rather than a build artefact, so Next has to compile it like our own
  // code. One less build step between changing a rule and seeing it apply.
  transpilePackages: ["@keiki/core"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },

  /**
   * Addresses that have moved.
   *
   * "My registrations" became "Dashboard" when the page grew a calendar, and
   * the URL moved with the name. This has to stay forever: every confirmation
   * email ever sent links to /portal, and those are in people's inboxes for
   * good.
   *
   * A config redirect rather than a page that calls redirect(): this is a
   * genuine 308 from the router, with no React render behind it, so a search
   * engine and a mail client both treat it as the permanent move it is.
   */
  async redirects() {
    return [
      { source: "/portal", destination: "/dashboard", permanent: true },

      /**
       * The console's catalogue became Classes and Setup.
       *
       * "Catalogue" and "Rosters" were two front doors onto the same 28 records,
       * one to edit a class and one to see who was in it, so they became one
       * Classes workspace with the reference data underneath /setup.
       *
       * Staff paste console URLs to each other constantly and there are bookmarks
       * on office machines nobody is going to be told about, so the old addresses
       * keep working. Order matters here: the more specific class rules have to be
       * matched before the catch-all, because Next takes the first match.
       */
      {
        source: "/admin/catalogue/classes/new",
        destination: "/admin/classes/new",
        permanent: true,
      },
      {
        source: "/admin/catalogue/classes/:id",
        destination: "/admin/classes/:id/edit",
        permanent: true,
      },
      { source: "/admin/catalogue/classes", destination: "/admin/classes", permanent: true },
      { source: "/admin/catalogue/schools", destination: "/admin/setup/campuses", permanent: true },
      { source: "/admin/catalogue", destination: "/admin/setup/programs", permanent: true },
      // Import is gone. The office should be using this system rather than
      // being handed a button that pulls their old one back in every time.
      // The importer itself still exists, as a seeding script, which is where a
      // one time migration belongs.
      { source: "/admin/catalogue/import", destination: "/admin/setup/programs", permanent: true },
      { source: "/admin/setup/import", destination: "/admin/setup/programs", permanent: true },
      { source: "/admin/catalogue/:path*", destination: "/admin/setup/:path*", permanent: true },

      /**
       * Setup has no landing page of its own, only its three records.
       *
       * This was a page calling `redirect()`, and it answered **200**. Same trap
       * the proxy documents: the console layout is async, so the shell has
       * already begun streaming by the time the page body runs, and once a
       * response is streaming its status is long gone. The redirect still
       * arrives, as an instruction inside the stream, so a browser follows it
       * and it looks fine; anything reading status codes sees a page that
       * exists at a URL that should not have one.
       *
       * A config redirect happens in the router before any of that, so it is a
       * real 308.
       */
      { source: "/admin/setup", destination: "/admin/setup/programs", permanent: true },
    ];
  },
};

export default nextConfig;
