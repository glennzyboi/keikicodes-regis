import type { Metadata } from "next";
import { NotFoundView } from "../not-found-view";

export const metadata: Metadata = {
  title: "Not found — Keiki Coders",
  // The proxy already answers 404, but a crawler that renders the page should
  // be told the same thing twice rather than once.
  robots: { index: false, follow: false },
};

/**
 * Where `src/proxy.ts` rewrites a URL that cannot be valid.
 *
 * A rewrite rather than a redirect, so the address bar still shows the broken
 * link the visitor actually followed, and the response carries a real 404
 * instead of the soft one a streamed `notFound()` produces.
 *
 * Nothing links here on purpose. It is an internal destination for the proxy.
 */
export default function LinkGone() {
  return <NotFoundView />;
}
