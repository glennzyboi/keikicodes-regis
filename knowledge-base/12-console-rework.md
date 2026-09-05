# The console rework, and the Stripe embed

5 September 2026. What changed, why, and the things that only showed up by
driving it rather than by reading it.

---

## The two reported bugs, and their real causes

**"The login keeps going stale."** `supabase/config.toml` sets `jwt_expiry =
3600` with `enable_refresh_token_rotation = true` and a ten second reuse
window. A Server Component meeting an expired access token refreshes it,
receives a **new** refresh token, and then tries to write the cookie, which
throws, because cookies are read only in a Server Component. Both
`staff-auth.ts` and `parent-auth.ts` swallowed that, correctly, because there
is nothing else they can do there. So the server had rotated the token and
revoked the old one, and the browser still held the old one. The next request
had no session.

Fixed in `proxy.ts`, which owns a response and can therefore write the cookie.
It affected parents exactly as much as staff.

**"The sidebar is still seen when we are logged out."** `/admin/login` sat under
the same layout as every console page, making it a sibling beneath a shared
layout, and Next does not re-render a shared layout on a client side navigation
between siblings. Signing out is a client navigation, so the page swapped and
the already-mounted rail stayed. A hard reload always looked right, which is why
it survived.

Fixed by moving the console into a `(console)` route group, so leaving it
crosses a layout boundary. That also collapsed seven repeated `currentStaff()`
checks into one gate.

---

## The decision that removes the duplication

There is exactly **one** record the office works on: the class offering, which is
a program, at a campus, in a term. Schools, programs and terms are things it
points at, so they are filters and columns on the class list rather than places
to go hunting.

`/admin/classes` is the one list. A campus page and a program page render **that
same component** with a filter pinned. Verified by consequence rather than by
inspection: a test asserts both entrances return identical class id sets, so if
they are ever forked it fails.

Their own data is why this is right: 28 offerings across **13** program names,
with "Code Heroes: Virtual Reality" running at five campuses, each with its own
grades, weekday, price and holidays.

Rail: Today, People, Teaching, Setup, System. Seat holds and the outbox moved to
System because they are machinery, not queues anybody works.

---

## Things that only appeared by driving it

| Found | Why it mattered |
|---|---|
| `/admin/setup` answered **200**, not a redirect | Same streamed-status trap `proxy.ts` documents: the console layout is async, so the shell is already streaming when the page body calls `redirect()`. A browser follows it; anything reading status codes sees a page at a URL that should not have one. Now a config 308. |
| Every list had a new race | Suspense fallbacks live in the page now, so a fallback and the real rows share the document while streaming. Both matched `.ops-table`, which is a Playwright strict mode violation that fails instantly. Skeletons have their own class. |
| The image upload was inert until hydration | Picking a file submits from a change handler that does not exist until React hydrates. A person will not beat it; a test does every time. The control reports readiness now. |
| `countOf('unconfirmed')` asked a third different question | It tested `status='pending'`; the list and the rail badge both test `status='paid' and fulfilled_at is null`. Harmless until that list paged, which this change does. |
| The suite only passed if the shell exported `DATABASE_URL` | Nothing loaded it. Specs failed with `ECONNREFUSED 127.0.0.1:5432`, the default port, which is the tell. `playwright.config.ts` loads `.env.local` now. |
| `scratchClass()` never checked "untouched" | It claimed it and only asked for six future dates, so it handed back classes earlier specs had already moved. Tightening it too far was worse: their catalogue ships holidays, so the seed carries 57 `from_blackout` cancellations and "no cancelled sessions" left **one** eligible class and broke six specs. A blackout is the class as published; anything else is a test's doing. |

---

## The Stripe embed

`ui_mode: "embedded"` is **refused** on API version `2026-08-26.dahlia`:

> The ui_mode value `embedded` is no longer supported. Use `embedded_page` instead.

Every tutorial and most of Stripe's older docs still say `embedded`.

Two landmines, both real:

1. **The session-reuse branch tested `existing.url`.** An embedded session has no
   `url` at all, so the branch that makes a double submit safe would have been
   permanently false and every double submit would have created a second Stripe
   session. Now tests `client_secret`.
2. **`Permissions-Policy: payment=()`** denied the Payment Request API to every
   descendant frame, which is what puts Apple Pay and Google Pay in Stripe's
   iframe. Silent failure: card form fine, wallets simply absent, card-only tests
   green forever. Relaxed to `payment=(self "https://checkout.stripe.com"
   "https://js.stripe.com")`, and a test asserts the wallet element is attached.

**Driving Stripe's iframe from a test**, learned the hard way:
- The card fields do not exist until Card is chosen in the accordion.
- The accordion's radio is `tabindex="-1"` and Stripe drives it from the button,
  so `check()` reports "clicking the checkbox did not change its state".
- The button is off-viewport in any sensible window, and a forced Playwright
  click still needs coordinates. `el.click()` via `evaluate` is the way in.
- Stripe's frame nesting is versioned into the URL and the layout varies between
  renders, so the helper searches every frame for the field rather than walking a
  fixed path.

---

## Still true, still worth knowing

- No backticks inside a SQL comment in a tagged template. It ends the query
  mid-comment. This has now bitten twice.
- `.ops-search` was already the command palette trigger; the filter bar's search
  had to be renamed rather than share it.
- `.ops-label` is `display: block`, so it cannot also be the flex row.
