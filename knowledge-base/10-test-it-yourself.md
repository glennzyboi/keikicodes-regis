# Test it yourself

*Everything you need to drive the system by hand. Written 4 September 2026.*

---

## Before anything

Docker Desktop must be running. Then, from `KeikiCoders/`:

```bash
# 1. Database, auth and the local mail server
supabase start

# 2. The app
cd registration && ./node_modules/.bin/next dev --port 3000

# 3. Stripe webhooks, in its own terminal, from KeikiCoders/
SK=$(grep '^STRIPE_SECRET_KEY=' registration/.env.local | cut -d= -f2)
./tools/stripe.exe listen --api-key "$SK" --forward-to localhost:3000/api/stripe/webhook
```

The webhook forwarder prints a signing secret each time it starts. If it differs
from `STRIPE_WEBHOOK_SECRET` in `registration/.env.local`, paste the new one in.
Without it, payments will be taken and never confirmed.

---

## Where things are

| What | Where |
|---|---|
| Parent site | http://localhost:3000 |
| Office console | http://localhost:3000/admin |
| Local inbox, every email lands here | http://127.0.0.1:55324 |
| Database browser | http://127.0.0.1:55323 |
| Stripe dashboard, test mode | https://dashboard.stripe.com/test/payments |

---

## Logins

Both are created by the seed, and re-running the seed resets their passwords, so
these always work.

| Role | Email | Password |
|---|---|---|
| **Office staff** | `ops@keikicoders.test` | `KeikiOps!2026` |
| **Parent** | `parent@keikicoders.test` | `KeikiParent!2026` |

You can also create a parent account yourself at
http://localhost:3000/signup. Email confirmation is switched off locally, so you
are signed in immediately.

**Test card:** `4242 4242 4242 4242`, any future expiry, any CVC, any postcode.
No real money moves, ever. Everything is Stripe test mode.

---

## Things worth trying, in order

### 1. Register, and watch the whole chain fire

1. Open http://localhost:3000 and click a class card. It expands to the full
   detail: every date, the age range, how full it is.
2. Hit **Register**. You are bounced to sign in, carrying the destination, so
   after signing in you land back on that exact class.
3. Sign in as the parent above.
4. Add a child. The date of birth is three dropdowns rather than a date picker,
   because picking a year from a list beats paging a calendar back ten years.
5. Add a second child with **Add another child**. One order, two seats, one
   payment.
6. Pay with the test card. On Stripe's page you must pick **Card** first, the
   fields do not exist until you do.
7. You land on a page that says it is confirming, not confirmed. It waits for
   the webhook, because the redirect only proves your browser came back.
8. **Check the inbox** at http://127.0.0.1:55324. The confirmation is there.

### 2. See it from the office

Sign in at http://localhost:3000/admin as staff.

- **Overview** has the chart, the activity feed and the capacity table.
- **Money** merges what used to be three tabs. Open **All orders** and click a
  row: it expands to the full detail with a link straight into Stripe.
- **Families**, then open one. This is the page the office lives on: the keiki
  and their medical notes, every registration, every payment, every message we
  sent, and a place to log what was said on the phone.
- **Schedule** is a month calendar across every campus.
- **Classes**, then open one, gives you the roster, the calendar and the money
  for that class.

### 3. Cancel a class date and watch forty parents get told

1. **Classes**, open Scratch Adventures, scroll to Schedule.
2. **Cancel next class**, write a note, confirm.
3. Run the worker:
   ```bash
   cd registration && ./node_modules/.bin/tsx --env-file=.env.local scripts/notify.ts
   ```
4. Check http://127.0.0.1:55324. Everyone enrolled has the notice, with the
   cancelled date and the next session that still stands.

The message was written to the database inside the same transaction as the
cancellation. If the cancellation had rolled back, nobody would have been told.

### 4. Approve a cancellation and refund it automatically

1. As the parent, open **My registrations**, switch to **Details**, expand a
   registration and **Request cancellation**.
2. As staff, go to **Money**, then **Cancellations**.
3. **Approve and refund.** Choose full, pro rata on sessions still to run, or
   type an amount.
4. The refund goes to Stripe immediately. Check
   https://dashboard.stripe.com/test/payments: the payment shows **Partial
   refund** or **Refunded**.
5. **Money** then **Refunds owed** shows the Stripe refund id and its confirmed
   status.

### 5. Prove it cannot oversell

```bash
cd registration
./node_modules/.bin/tsx --env-file=.env.local scripts/thunder.ts
```

Fifty simultaneous registrations against a twelve seat class. Expect exactly the
free seats accepted, everyone else told the class is full, and zero other
failures.

If the class already has people in it, reseed first so there are twelve free
seats, or pass `--class "Web Design Basics"` to pick an emptier one. The script
says up front how many seats were free, and adapts its checks.

It drives the registration transaction directly rather than posting to the API,
because registration requires an account and driving fifty signed in sessions
from a CLI means reimplementing Supabase's cookie format. **The HTTP path is
proven separately**, by a test in `tests/jobs.spec.ts` that races eight real
signed in browser contexts through the endpoint.

### 6. Prove reminders cannot double send

```bash
./node_modules/.bin/tsx --env-file=.env.local scripts/reminders.ts --days 14
./node_modules/.bin/tsx --env-file=.env.local scripts/reminders.ts --days 14
```

The first run queues them. The second queues nothing and says so. Then deliver:

```bash
./node_modules/.bin/tsx --env-file=.env.local scripts/notify.ts
```

### 7. Prove a child cannot be in two places at once

Register a child for **Roblox Studio Lab** (Thursdays 3:15 to 4:30). Then try to
add **Web Design Basics** (Thursdays 4:00 to 5:00) in the same submission. The
option is greyed out on the form, and if you get past the form the server
refuses with a message naming the clash.

### 8. Prove the seat sweeper protects paid seats

```bash
./node_modules/.bin/tsx --env-file=.env.local scripts/sweep-holds.ts --dry
./node_modules/.bin/tsx --env-file=.env.local scripts/sweep-holds.ts
```

Abandoned checkouts release their seats. A hold belonging to a paid order is
reported as protected and left alone.

### 9. Run the test suite

```bash
cd registration
set -a && . ./.env.local && set +a
./node_modules/.bin/playwright test
```

**61 specs across five files**, taking about three minutes. Several pay with a
real test card against real Stripe, and one issues a real refund.

| File | What it is for |
|---|---|
| `auth.spec.ts` | Signed out, wrong role, and one family reaching for another's data |
| `abuse.spec.ts` | Malformed ids, rubbish payloads, injection, open redirects |
| `admin.spec.ts` | Every console tab, checked against the database |
| `parent.spec.ts` | Signup through cancellation, and the full money lifecycle |
| `jobs.spec.ts` | The background scripts, plus eight browser contexts racing |

Run one file at a time with `./node_modules/.bin/playwright test tests/auth.spec.ts`.

The suite reseeds in global setup, so it never inherits the previous run, and
the two tests that fill a class put it back afterwards.

---

## Resetting

```bash
cd registration && ./node_modules/.bin/tsx --env-file=.env.local scripts/seed.ts
```

This clears families, orders, holds and enrollments, and leaves the catalogue
alone. Class ids survive, so any link you have open still works.

To clear the inbox, use the delete button in Mailpit.

---

## What is not wired up yet

Being explicit so nothing surprises you on camera.

- **Google sign in.** The code path is written and the button appears when
  `NEXT_PUBLIC_GOOGLE_AUTH=true`, but it needs a Google client id and secret.
- **Resend.** Local mail goes to Mailpit. To send for real, put
  `RESEND_API_KEY` in `.env.local` and set `EMAIL_TRANSPORT=resend`.
- **SMS.** The notifications table has a channel column and the worker refuses
  cleanly for anything with no transport, so Twilio is a file rather than a
  migration. Not built.
- **The topbar search box** in the console is decoration. Use the search on the
  Families and Students pages, which is real. Either wire it or remove it before
  recording.
