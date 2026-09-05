import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Two jobs, both of which have to happen before a page renders.
 *
 * ---------------------------------------------------------------------------
 * 1. Keeping a live session alive
 * ---------------------------------------------------------------------------
 *
 * This is the fix for "the login keeps going stale", and the cause is worth
 * writing down because it is invisible from the outside and it bites parents
 * and staff identically.
 *
 * `supabase/config.toml` sets `jwt_expiry = 3600` with
 * `enable_refresh_token_rotation = true` and a ten second reuse window. So an
 * access token dies after an hour, and refreshing it **consumes** the refresh
 * token and issues a new one; the old one stops working almost immediately.
 *
 * A Server Component that calls `getUser()` on an expired token does trigger
 * that refresh. It then tries to write the new cookies, and **that write throws,
 * because cookies are read only in a Server Component.** Both `staff-auth.ts`
 * and `parent-auth.ts` swallow the throw, which is the only thing they can do
 * there.
 *
 * The result is a session that destroys itself: the server has rotated the
 * refresh token and revoked the old one, and the browser still holds the old
 * one, because nothing was ever able to hand it the new one. The next request
 * has no session at all. Signed in at 9, signed out at 10, with nothing in any
 * log to say why.
 *
 * A proxy owns a response, so it can write the cookie. Calling `getUser()` here
 * is what makes the rotation land in the browser. It is the documented
 * `@supabase/ssr` pattern and it is not optional with rotation turned on.
 *
 * **This is not a security boundary and must never be mistaken for one.** It
 * refreshes a session that is already valid; it decides nothing about who may
 * see what. Every route behind it re-checks identity and ownership for itself,
 * because a proxy can be bypassed by anything that reaches the origin directly.
 *
 * ---------------------------------------------------------------------------
 * 2. Malformed ids, refused before anything is rendered
 * ---------------------------------------------------------------------------
 *
 * This exists because of something the test suite found and the framework
 * documents: when a response is streamed, the HTTP status is sent before the
 * page body runs, so a `notFound()` inside a dynamic page arrives as a **200**
 * carrying the not-found UI. Next injects `<meta name="robots" content=
 * "noindex">` so it is not indexed, and for a genuinely missing record that
 * trade is fine, which is why it is the framework's default.
 *
 * It is not fine for a URL that cannot possibly be valid. `/programs/not-a-uuid`
 * is not a class that has gone away, it is a typo or somebody poking at the
 * routes, and answering 200 to that is a soft 404: it shows up in analytics as
 * a real page view, and it means a broken link in a message thread looks like
 * a working one to anything reading status codes.
 *
 * So the shape is checked here, where the answer is a real 404. Deliberately
 * only the shape: it does a regex and nothing else, **no database, no session,
 * no fetch**, and it runs first so a malformed URL never costs a round trip to
 * the auth server. A well formed id for a class that does not exist still
 * reaches the page and still gets the streamed not-found with `noindex`, which
 * is exactly what that case deserves.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lowercase, digits and single hyphens. What `slugify` in core produces. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The two areas that are behind a login and therefore have a session to keep. */
const SIGNED_IN_AREAS = ["/admin", "/dashboard"];

export async function proxy(request: NextRequest) {
  const gone = badShape(request);
  if (gone) return gone;

  const path = request.nextUrl.pathname;

  // The login page itself is deliberately included: arriving there with a
  // refreshable session is how "already signed in, go to the console" works,
  // and it is the one place a rotation is most likely to be pending.
  if (SIGNED_IN_AREAS.some((a) => path === a || path.startsWith(`${a}/`))) {
    return refreshSession(request);
  }
}

/**
 * Touch the session so a rotated token reaches the browser.
 *
 * The response is rebuilt inside `setAll` rather than mutated afterwards. That
 * looks redundant and is not: the request's own cookie jar has to carry the new
 * values too, so that anything rendering downstream in this same pass reads the
 * refreshed session rather than the expired one it arrived with.
 */
async function refreshSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // `getUser` rather than `getSession`: it verifies the token against the auth
  // server instead of trusting what is in the cookie, and it is the call that
  // performs the refresh when one is due. The answer is thrown away here on
  // purpose. Nothing is authorised at this layer.
  //
  // A refresh that fails is a signed-out visitor, which is a normal state and
  // not an error. Letting it throw would turn an expired cookie into a 500 on
  // every page of the site.
  try {
    await supabase.auth.getUser();
  } catch {
    // Auth server unreachable. Carry on: the page will find no session and send
    // them to the login form, which is the correct outcome anyway.
  }

  return response;
}

function badShape(request: NextRequest) {
  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) return;

  const [collection, value] = segments;
  const decoded = safeDecode(value);
  if (decoded === null) return notFound(request);

  if ((collection === "programs" || collection === "register") && !UUID.test(decoded)) {
    return notFound(request);
  }
  if (collection === "schools" && (!SLUG.test(decoded) || decoded.length > 120)) {
    return notFound(request);
  }
}

/** A percent sequence that is not valid UTF-8 throws rather than returning. */
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function notFound(request: NextRequest) {
  // A rewrite rather than a bare Response, so the visitor gets the site's own
  // not-found page in the site's own layout, with a real 404 on it.
  return NextResponse.rewrite(new URL("/link-gone", request.url), { status: 404 });
}

export const config = {
  // The three routes that take an id or a slug in the path, plus the two areas
  // that hold a session. Everything else, including every asset, skips this
  // entirely: a proxy that runs on every request is a tax on every request.
  matcher: [
    "/programs/:value",
    "/register/:value",
    "/schools/:value",
    "/admin/:path*",
    "/dashboard/:path*",
  ],
};
