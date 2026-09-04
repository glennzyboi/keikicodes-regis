# Build status and knowledge transfer

*Written 4 September 2026, mid-build, so a fresh session can resume without
re-deriving anything. Update this file as work continues.*

---

## THE GOAL

Build a **parent registration system** demo for Keiki Coders, record a Loom
walkthrough, and send it. It is a **paid trial task**, USD 25 via Wise, and it
replaces the interview they cancelled on 4 September.

**Deadline: within 5 days of 4 September, so 9 September. Target sending on
8 September.** The full brief is in `04-the-brief.md`, verbatim. Read that, never
a paraphrase.

They judge **structure and the decisions behind it**, in their own words. Five of
their seven questions are about failure and concurrency, not features. The build
exists to make those answers demonstrable.

The overall plan, the Loom script and the answers to all seven of their questions
are written up at `../keiki-build-plan.html` in the parent folder.

---

## WHERE EVERYTHING LIVES

Everything is inside `Desktop\Upwork-Profile-Update\KeikiCoders\`. Nothing outside it.

```
KeikiCoders/
  knowledge-base/        this folder. Client knowledge, the brief, brand tokens
  registration/          the Next.js app
  supabase/              config.toml and migrations
  tools/stripe.exe       Stripe CLI 1.50.10, gitignored
```

A second empty folder exists at `Desktop\KeikiCoders`. **Unused. Glenn was asked
whether to delete it and has not answered.**

---

## DECISIONS ALREADY SETTLED

These came out of a full grilling session with Glenn. Do not reopen them without
asking him.

| Decision | Answer |
|---|---|
| Folder | `Upwork-Profile-Update\KeikiCoders` |
| Local stack | Supabase CLI in Docker, Next.js on the host |
| Parent login | **None.** Guest checkout, then a signed expiring link to the portal |
| Staff login | Real Supabase Auth password login, RLS keyed to a `staff` table |
| Stripe catalogue | Our DB owns the class; **Stripe mirrors it** with real Products and Prices. Price changes mint a new Price and repoint |
| Waitlist | **OUT.** Never mentioned in their brief. Confirmed by re-reading. It is a sentence Glenn says, not code |
| Refunds | Approve and flag `refund_owed`, mark refunded by hand. Their refund policy is unknown |
| Mid-semester joins | Flat price, enrollment records `starts_from_session_id`, admin override |
| Theme | **Full brand match**, not a calmer variant. Glenn chose this explicitly |
| Seed data | Real schools and programs. Nothing personal to Glenn anywhere |
| Timezone | Store `timestamptz`, render in the school's timezone, never the viewer's |
| Tests | Playwright, written as evidence to show on camera |
| Git | Local only, no remote |
| Deploy | Local only for now. Vercel plus Supabase cloud later |

---

## RUNNING IT

Docker Desktop must be running first.

```bash
# 1. Local Supabase (non-default ports, see below)
cd KeikiCoders && supabase start

# 2. Dev server
cd registration && ./node_modules/.bin/next dev --port 3000

# 3. Stripe webhook forwarding, in its own terminal
cd KeikiCoders
SK=$(grep '^STRIPE_SECRET_KEY=' registration/.env.local | cut -d= -f2)
./tools/stripe.exe listen --api-key "$SK" --forward-to localhost:3000/api/stripe/webhook
```

**Ports are deliberately non-standard.** Glenn has two other Supabase stacks on
this machine (`checksocial`, `restorative-spaces`) that auto-start with Docker
Desktop and hold 54321 to 54324. Ours was moved in `supabase/config.toml` rather
than stopping his other projects:

| Service | Port |
|---|---|
| API | 55321 |
| Database | 55322 |
| Studio | 55323 |
| Mailpit | 55324 |
| Shadow DB | 55320 |
| Analytics | 55327 |

**pnpm is broken in this project** and refuses to run scripts because of ignored
esbuild build scripts. `pnpm-workspace.yaml` with `onlyBuiltDependencies` did not
fix it. **Workaround: call the binaries directly**, which works fine:

```bash
./node_modules/.bin/tsx --env-file=.env.local scripts/seed.ts
./node_modules/.bin/playwright test
./node_modules/.bin/next dev
```

Seeding: `./node_modules/.bin/tsx --env-file=.env.local scripts/seed.ts`
It truncates the operational tables, recreates the catalogue, materialises every
session, creates Stripe Products and Prices, and creates the staff login.

**Staff login: `ops@keikicoders.test` / `KeikiOps!2026`**

Secrets are in `registration/.env.local`, which is gitignored and verified not
staged. Stripe keys are **test mode only**. Webhook signing secret is currently
`whsec_67a7852f...`, which changes every time `stripe listen` restarts, so
re-read it and update `.env.local` when it does.

---

## WHAT IS BUILT AND VERIFIED

**Schema**, `supabase/migrations/20260904071342_initial_schema.sql`. This is the
source of truth for the schema; `registration/src/lib/schema.ts` is a typed
Drizzle mirror for queries only. If they disagree, the SQL wins.

Tables: `staff, parents, children, schools, class_offerings, sessions, orders,
order_items, seat_holds, enrollments, webhook_events, enrollment_events`.

The invariants that matter, all enforced in the database:

- `check (seats_taken <= capacity)` on `class_offerings`
- `take_seat()`: one atomic `update ... where seats_taken < capacity`
- partial unique index `one_live_place_per_child` on `(class_offering_id, child_id)`
- `children_natural_key` unique on `(parent_id, lower(first), lower(last), dob)`
- `orders_idempotent` unique on `(parent_id, idempotency_key)`
- `webhook_events.id` primary key on Stripe's own event id
- RLS enabled on every table, default deny, public catalogue only

**Verified working:**

- Seat counter: 3 seats, 3 successes, 4th returns false, `seats_taken` capped
- Registration API creates order, items and holds, and takes seats before payment
- **Idempotency: three identical submissions produced one order, one seat, one
  parent** (verified by hand with curl before the Playwright run)
- Stripe Checkout Session created with server-built line items from stored price ids
- Seed created 6 classes across 3 real schools with real Stripe Prices

**Files written:**

```
registration/src/lib/       db.ts schema.ts stripe.ts portal-token.ts registration.ts
registration/src/app/       layout.tsx globals.css page.tsx confirming/page.tsx
                            register/[id]/page.tsx  register/[id]/register-form.tsx
registration/src/app/api/   register/route.ts  stripe/webhook/route.ts  orders/[id]/route.ts
registration/scripts/       seed.ts
registration/tests/         registration.spec.ts
```

---

## WHERE IT STOPPED, AND WHAT TO DO NEXT

**Everything below is built, running and verified against the real Stripe test
account.** The two Playwright specs pass, the payment path works end to end, and
refunds go out through the Stripe API.

### What got fixed to get here

**1. Stripe's hosted checkout changed shape.** Payment methods are now a
collapsed accordion, so card fields do not exist in the DOM until Card is
chosen, and the row is covered by a click overlay that reports itself offscreen.
What works:

```ts
await page.getByRole("radio", { name: "Card" }).check({ force: true });
```

Email is no longer an input: it is passed as `customer_email` and rendered as
read-only text.

**2. A double-clicked submit could 500.** Two concurrent requests for the same
order both reached Stripe with idempotency key `checkout:<order id>`, and Stripe
rejects concurrent use of an in-progress key. Fixed by serialising the checkout
work per order with `select ... for update`. The database side was already safe:
the parent upsert takes a row lock that serialises the two transactions.

**3. The sweeper could take a seat back from a parent who had paid.** It deleted
every expired hold regardless of the order behind it. Holds were also 15 minutes
against a 30 minute Stripe session, so a parent who took their time lost the seat
while still holding a live payment page. Both fixed: one shared constant, and
`release_expired_holds()` now only touches holds whose order is unpaid.

**4. Row level security was decorative.** The schema enabled RLS and wrote
policies but never granted `anon` and `authenticated` any table privileges, and
every query ran as the database owner, which bypasses RLS entirely. A policy only
narrows a grant, so with no grant the policies decided nothing. Granted them and
the policies became load bearing. Proven both ways: as staff the console sees 12
parents, as anyone else it sees none.

**5. formatMoney lived in lib/stripe**, which constructs the Stripe client at
import time. A shared UI component importing it dragged the server-only module
into the client bundle and crashed the page. Split into `lib/money.ts`.

### What is now built

- **Parent portal** at `/portal`. HMAC signed link, thirty days, no password.
  Lists registrations, requests a cancellation. The reissue endpoint answers
  identically whether or not an address is on file.
- **Refunds, automated.** Approving a cancellation issues the refund through the
  Stripe API in the same action, keyed on the enrollment id so a retry returns
  the original refund rather than paying twice. Full, pro rata on sessions still
  to run, or a typed amount. `refund_owed` only clears when Stripe confirms
  succeeded, and refund webhooks keep the status honest afterwards.
  **Verified: a $200 partial refund of a $640 order reached Stripe as
  `re_3UBsEM...`, came back succeeded, and freed the seat.**
- **Ops console.** Dark rail, a route per queue: Overview, Payments,
  Cancellations, Refunds, Seat holds, Classes. Its own design system in
  `admin/ops.css`, imported by the admin layout and nowhere else. Charts are hand
  rolled SVG rendered on the server.
- **Parent site redesigned.** Each program has its own colour, mark and tag,
  matched on the class title. Cards carry age range, day, length, start date and
  a fill bar.
- `scripts/sweep-holds.ts` with `--watch` and `--dry`. Demonstrated releasing an
  abandoned seat while protecting a paid one.
- `scripts/thunder.ts`. **50 simultaneous registrations against 10 free seats
  accepted exactly 10, told 40 the class was full, left the counter at 12/12,
  zero other failures.**
- Playwright reseeds in global setup, so a run never inherits the run before it.

### The 404 on Register, and why it happened

Worth keeping, because it is the kind of bug that only appears once other
things are working.

The seed truncated `class_offerings` and inserted fresh rows, so every run
minted a **new uuid for every class**. Once the Playwright suite started
reseeding in global setup, running the tests silently invalidated every
`/register/<id>` link anyone had open: the catalogue in a browser tab pointed at
classes that no longer existed, and clicking Register gave Next's default
"This page could not be found".

Fixed three ways:

- A natural key on the catalogue, `(school_id, lower(title), term)`, and the
  seed upserts against it. Class ids and Stripe price ids now survive a reseed,
  verified by diffing them across two runs. It also stops the seed creating a
  duplicate Stripe Product and Price every time it runs.
- A malformed id used to be a **500**, because Postgres raises on a bad uuid
  cast. `lib/uuid.ts` guards the register page and the orders API, so a wrong
  address is a 404.
- A branded not-found page at `(site)/not-found.tsx`, so a stale link explains
  itself instead of showing the word 404.

### Still to do

1. Record the Loom. Script is in `../keiki-build-plan.html` section 08.
2. Mid-semester join in the admin. The schema supports it
   (`starts_from_session_id`) and the seed sets it, but there is no UI to
   override it.
3. The topbar search is presentational. It should either be wired up or removed
   before the walkthrough, because a demo that clicks a dead control is worse
   than one that never shows it.

---

## THINGS THAT WILL BITE A FRESH SESSION

- **The Playwright MCP browser is locked.** Glenn has Chrome open on that profile,
  so `mcp__playwright__browser_*` returns "Browser is already in use". He has said
  stale sessions can be closed. The project's own `@playwright/test` works fine
  and is what the specs use.
- **`tx.json()` does not work** inside a `sql.begin()` transaction in postgres.js.
  Use `${JSON.stringify(x)}::jsonb`. This already bit once.
- **The Stripe API version must be `2026-08-26.dahlia`**, which is what the
  installed SDK pins. Guessing a version returns a 400.
- **`supabase db reset` wipes everything**, including the staff auth user's row in
  `staff`. Reseed after any reset.
- **Zero em dashes** in anything Glenn sends to a client. House rule, absolute.

---

## OPEN QUESTIONS FOR GLENN

1. **His Wise email or phone number**, needed for the payment line at the end of
   the Loom. Asked once, not yet answered.
2. Whether to delete the empty `Desktop\KeikiCoders` folder.
3. Whether to send the drafted reply to Peter, which is in
   `../keiki-build-plan.html` section 10. It acknowledges the change, commits to
   8 September, and asks one scoping question about waitlist versus a clean stop.
   **Sending it today was the recommendation and it has not gone out.**
