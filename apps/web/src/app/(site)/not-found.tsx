import { NotFoundView } from "./not-found-view";

/**
 * A class that is not there any more.
 *
 * The most likely way a parent lands here is a bookmarked or shared link to a
 * class that has since closed, so the page says that plainly and puts the
 * catalogue one click away, rather than showing them the word 404.
 *
 * Reached by `notFound()` from a page. Because these pages stream, that arrives
 * as an HTTP 200 with a `noindex` tag rather than a 404, which is documented
 * Next behaviour and is the right trade for a record that genuinely used to
 * exist. A URL that could never have been valid is caught earlier, in
 * `src/proxy.ts`, where a real 404 is still possible.
 */
export default function NotFound() {
  return <NotFoundView />;
}
