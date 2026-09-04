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

**Logins, both created by the seed:**

| Role | Email | Password |
|---|---|---|
| Staff | `ops@keikicoders.test` | `KeikiOps!2026` |
| Parent | `parent@keikicoders.test` | `KeikiParent!2026` |

**Background jobs**, all safe to run repeatedly:

```bash
./node_modules/.bin/tsx --env-file=.env.local scripts/notify.ts          # deliver queued mail
./node_modules/.bin/tsx --env-file=.env.local scripts/reminders.ts       # queue today's reminders
./node_modules/.bin/tsx --env-file=.env.local scripts/sweep-holds.ts     # release abandoned seats
./node_modules/.bin/tsx --env-file=.env.local scripts/thunder.ts         # the 50 against 12 proof
```

Mail lands in Mailpit at **http://127.0.0.1:55324**, which is worth having open
during the walkthrough.

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

## WHERE IT IS NOW

**Everything below is built, running, and verified against the real Stripe test
account and a real local inbox.** Four Playwright specs pass.

The answers to all seven of their questions are written up in
`09-their-questions.md`. Read that before recording anything.

### What the system does

**Parents**
- Real accounts. Email and password today, Google the moment there are client
  credentials. **No magic links:** the first cut used an HMAC signed link, and a
  link that IS the credential is the wrong trade for a system holding children's
  dates of birth and medical notes.
- Browse classes, register one or several children in one submission, pay once
  through Stripe Checkout.
- Portal shows every registration across terms, and requests a cancellation.

**Office console at `/admin`**, its own design system, grouped by job:
- **Today**: Overview with charts and an activity feed, Payments taken but not
  confirmed, Cancellations to decide, Refunds ledger.
- **People**: Families with search across parent name, email and children's
  names. A family page showing keiki, medical notes, registrations, payment
  history with Stripe links, every message we sent them, and an append only log
  of phone calls. Students list across all families.
- **Programs**: Classes with a detail page carrying roster, schedule and the
  payments for that class. Schedule grouped by day. Seat holds.
- **Comms**: the outbox, with delivery state, retry and stop.

**Automation**
- A **notifications outbox**. Messages are written in the same transaction as
  the thing that caused them and delivered by a worker. Nothing sends inline.
- Triggers: registration confirmed, session cancelled, session rescheduled,
  cancellation approved, and a day-of class reminder.
- `dedupe_key` makes enqueueing idempotent. Running the reminder job twice
  queued 2 then 0.
- Refunds go to Stripe automatically on approval, keyed on the enrollment id so
  a retry never pays a family twice.

### Verified, with numbers

- **50 simultaneous registrations against 10 free seats**: exactly 10 accepted,
  40 told the class was full, 0 other failures, counter left at 12/12.
- **Concurrent double submit**: one order, one seat, one parent.
- **Full payment path**: register, pay on Stripe, webhook fulfils, seats and
  holds reconcile, confirmation email queued and delivered.
- **A $200 partial refund** of a $640 order reached Stripe as `re_3UBsEM...`,
  came back succeeded through the webhook, and freed the seat.
- **Row level security both ways**: as staff the console sees every family, as
  anyone else it sees none.
- **The sweeper protects paid seats**: an expired hold on a paid order was left
  alone while an abandoned one was released.

### Bugs found and fixed along the way

Worth keeping, because they are the interesting part.

1. **Stripe checkout changed shape.** Payment methods are now a collapsed
   accordion, so card fields do not exist until Card is chosen, and the row is
   covered by an offscreen click overlay. Use
   `getByRole("radio", { name: "Card" }).check({ force: true })`.
2. **A double clicked submit could 500.** Both requests called Stripe with the
   same idempotency key. Fixed with a row lock per order.
3. **The sweeper could take a seat back from a parent who had paid**, and holds
   expired at 15 minutes against a 30 minute payment page. One shared constant,
   and the function now only releases holds whose order is unpaid.
4. **Row level security was decorative.** Policies existed but the roles had no
   table grants, and everything ran as the owner, which bypasses RLS. Granted,
   and it became load bearing.
5. **Reseeding broke every open link.** The seed truncated the catalogue and
   minted new class ids on every run. Now upserts on a natural key.
6. **A malformed id was a 500**, because Postgres raises on a bad uuid cast.
7. **formatMoney lived in lib/stripe**, dragging the server-only Stripe client
   into the client bundle.

### Still to do

1. **Record the Loom.** Script in `../keiki-build-plan.html` section 08, but it
   predates accounts and notifications, so it needs a pass first.
2. **Google OAuth needs credentials.** The code path is written and the button
   appears when `NEXT_PUBLIC_GOOGLE_AUTH=true`, but it cannot be demonstrated
   without a Google client id and secret.
3. **Resend needs an API key** to send for real. Local Mailpit is wired and
   working, which is arguably the better demo anyway.
4. **The topbar search is presentational.** Wire it to the families search or
   remove it before recording. Clicking a dead control on camera is worse than
   never showing it.

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
