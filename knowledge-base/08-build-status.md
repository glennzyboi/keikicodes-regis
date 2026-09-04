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
registration/scripts/       seed.ts  probe-checkout.ts (throwaway diagnostic)
registration/tests/         registration.spec.ts
```

---

## WHERE IT STOPPED, AND WHAT TO DO NEXT

**Current state: the two Playwright specs are failing.** Be careful reading this,
it is not one problem.

1. **The payment spec** originally failed because Stripe's hosted page has a
   **required email field** that was never filled, so submit did nothing. Diagnosed
   with `scripts/probe-checkout.ts`, which dumps the real inputs on the hosted page.
   Fixed two ways: `customer_email` is now passed when creating the session so
   Stripe prefills it, and the spec fills it as a fallback.

2. **Adaptive pricing was showing pesos.** The hosted page offered
   `₱21,417.58 / $330.00` because the browser is in Manila. Now disabled with
   `adaptive_pricing: { enabled: false }` in the session, so the demo charges the
   USD amount the parent agreed to.

3. **After those two fixes both specs failed**, including the idempotency one that
   had passed on the previous run. That regression is the thing to look at first.
   Leading hypothesis: the dev server was still recompiling after the route edit
   when the run started, so the first requests 500'd. Second hypothesis: seats in
   `Python Starters` and `Scratch Adventures` have accumulated across runs and a
   class is now full, which the specs do not reset.

   **Do this first: reseed, confirm the server is warm, then rerun.**

   ```bash
   cd registration
   ./node_modules/.bin/tsx --env-file=.env.local scripts/seed.ts
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
   set -a; . ./.env.local; set +a
   ./node_modules/.bin/playwright test
   ```

   Traces and video are kept on failure in `registration/test-results/`.

**Still to build, in priority order:**

1. `/portal` page, reading the signed token, listing registrations, request a
   cancellation. `portal-token.ts` is written and ready.
2. `/admin`: paid-but-unfulfilled orders, expiring holds, approve a cancellation.
   Staff login exists and RLS policies are in place.
3. Session cancel and reschedule, and mid-semester join, in admin.
4. `scripts/sweep-holds.ts`, calling `release_expired_holds()`. The SQL function
   already exists and works; the script does not exist yet, and `pnpm sweep` in
   package.json points at it.
5. `scripts/thunder.ts`, the 50-against-12 concurrency proof. **This is the single
   most valuable remaining item**, because it answers their hardest question on
   camera. The plan document has the script sketched.
6. Record the Loom. Script is in `../keiki-build-plan.html` section 08.

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
