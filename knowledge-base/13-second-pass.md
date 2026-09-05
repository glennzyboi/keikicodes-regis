# The second pass: checkout, seed data, drops, and the things that were confusing

5 September 2026, after the console rework. Driven by a list of things that were
still wrong when the client used it.

---

## Checkout is in the page now

`ui_mode: "embedded"` is **refused** on this account's API version
(`2026-08-26.dahlia`):

> The ui_mode value `embedded` is no longer supported. Use `embedded_page` instead.

Every tutorial and most of Stripe's own older documentation still say
`embedded`. That is the single most likely thing to waste an afternoon here.

The registration page is now a shop checkout: form on the left, **order summary
pinned on the right**, and when payment starts Stripe's card fields take the left
column while the summary stays put. Nothing navigates. The submit button lives in
the pinned panel and reaches the form through `form="kc-register"`, so it is a
real submit and Enter still works.

Two landmines, both real, both fixed:

1. **The session reuse branch tested `existing.url`.** An embedded session has no
   `url` at all, so the branch that makes a double submit safe would have been
   permanently false and every double submit would have made a second Stripe
   session. It tests `client_secret` now.
2. **`Permissions-Policy: payment=()`** denied the Payment Request API to every
   descendant frame, which is exactly what puts Apple Pay and Google Pay in
   Stripe's iframe. Silent failure: card form fine, wallets absent, card-only
   tests green forever.

**Driving Stripe's iframe from a test**, learned the hard way and worth keeping:
- Card fields do not exist until Card is chosen in the accordion.
- The accordion's radio is `tabindex="-1"` and Stripe drives it from the button,
  so `check()` reports "clicking the checkbox did not change its state".
- The button is off-viewport in any sensible window, and a *forced* Playwright
  click still needs coordinates. `el.click()` via `evaluate` is the way in.
- Frame nesting is versioned into the URL and the layout varies between renders,
  so the helper searches every frame for the field rather than walking a path.

---

## A drop is not a refund

The build spec lists "kids sometimes join mid-semester, or drop" separately from
cancellations, and that separation is real:

| | Cancellation | Drop |
|---|---|---|
| Who starts it | The family, asking | The office, recording |
| Waits on a decision | Yes | No |
| Money | Usually goes back | None, unless separately decided |
| Seat | Freed on approval | Freed immediately |

Before this the only way to clear a roster was to approve a cancellation, which
meant refunding money nobody had asked for, or leaving the child and their seat
in place for the term. Both happened.

New `dropped` status, plus `dropped_reason_code`, `dropped_note`, `dropped_by`
and `dropped_from_session_id`. That last one is the mirror of
`starts_from_session_id`, and together they let a roster say **"week 3 to week
8"**, which is the span a pro-rata conversation actually starts from and a number
their current system cannot produce at all.

---

## Things that nearly shipped as bugs

| Nearly shipped | Caught by |
|---|---|
| **Editing a program would wipe its picture.** Removing the "Image URL" field left `image_url = ${f.imageUrl}` in the save action, so any edit wrote null over it. | Reading the action before deleting the field |
| **`ClassRow.weekday` typechecked but was undefined at runtime.** The type gained the field; the SELECT did not. TypeScript cannot see inside a SQL string. | Checking the query, not the compiler |
| **A backtick inside a SQL comment** ended the query mid-comment. Second time in this build. | The parser, loudly |
| **The demo seed could email strangers.** Realistic gmail addresses plus a live notification worker. | `seedFamilies` refuses to run against a non-local database |

---

## Auth: what was actually wrong

`currentStaff()` was not deduplicated per request, and every call is a **network
round trip to the auth server**. One class page called it four times: the proxy,
the console layout, the class layout, and `readAsStaff` in the page. The rail is
eleven prefetched links, so moving around the console fired dozens of requests,
each multiplying by four against one local auth container. Anything that timed
out came back as "no user", which is indistinguishable from "signed out", so the
layout redirected to the login page.

Both `currentStaff` and `currentParent` are wrapped in React `cache()` now. Per
request, so nothing is cached across people and nothing about authorisation
changes; the answer is simply computed once instead of four times.

Note for anyone reproducing this by hand: the Supabase session cookie is
**base64url**, not base64. Editing it with `btoa` corrupts it and produces a
convincing false positive.

---

## Program and class, simplified

"Create a program, then create a class" was the step everyone got stuck on, and
fairly: from the outside the two forms look like the same thing asked twice.

The distinction is real and the data keeps it, because one program genuinely does
run at several campuses with its own day, grades and price at each. It is just
not something an office should have to learn before adding their first class. So
the class form now has **"+ A program we do not have yet"** in the picker, which
reveals name, level and subject inline and creates the program **in the same
transaction as the class**, so a refused class does not leave an orphan program
behind. Typing a name that already exists uses that program rather than refusing.

---

## Still to do

- **Traffic, security, SEO and GTM** on the System group. Deliberately not faked:
  a placeholder page saying "not built" is noise for the office. Real work when
  it is wanted, and the honest place for it is a System overview that also shows
  job health and webhook failures.
- The parent dashboard has no drop view yet: a dropped place shows as ended, but
  the reason is staff-facing only, which is probably right and worth confirming.
