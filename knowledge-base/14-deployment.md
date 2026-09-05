# Where the prototype lives

Everything below is test mode. There is no live Stripe key anywhere in this
project and there never has been.

## The three pieces

| Piece | Where | Address |
|---|---|---|
| The site and the console | Vercel, project `keikicoders-registration`, root `apps/web` | https://keikicoders-registration.vercel.app |
| The catalogue API and health check | Render, free web service `keiki-api`, repo root | `keiki-api` on onrender.com |
| Postgres, auth, storage | Supabase project `anruifpqccsutivzmhep` (`KeikiCoders`, ap-southeast-1) | — |

Two GitHub repositories hold the same monorepo, because both halves import
`packages/core` and neither can be built from a slice of it:

- `glennzyboi/keikicodes-web` — what Vercel builds
- `glennzyboi/keikicodes-regis` — what Render builds

Both are `main`. A push to either deploys that half.

## Connecting to the database

The direct host, `db.anruifpqccsutivzmhep.supabase.co`, only answers on IPv6.
This machine and Render are both IPv4, so everything goes through the pooler:

- **Session pooler**, port 5432, for Render and for scripts run from a laptop.
- **Transaction pooler**, port 6543, for Vercel, because a serverless
  deployment reaches the connection ceiling by having many small pools rather
  than one big one.

Both need `prepare: false`, which `packages/core/src/db.ts` already sets: the
transaction pooler hands a different backend to each statement, so a named
prepared statement made on one is missing on the next. Without it everything
works locally and fails intermittently once deployed. `DATABASE_POOL_MAX` is 3
on both.

## The jobs

The seat sweeper is **not** a container any more. It is one statement,
`select release_expired_holds()`, and every safety property it has already
lives inside that function, including that it will not touch a hold whose order
has been paid. It now runs as a pg_cron job in the database, every minute:

```sql
select jobname, schedule, command from cron.job;
-- release-expired-seat-holds | * * * * * | select release_expired_holds()
```

That is both cheaper and more reliable than a scheduler that can be asleep at
exactly the moment holds are ageing, which a free web service is after fifteen
minutes of quiet.

Notifications and reminders are still application work — they render templates
and call Resend over HTTP — so they stay in `render.yaml` as cron services.
They are **not** running, because Render cron jobs need a paid plan and, on
this deployment, they would have nothing to deliver anyway. See below.

## Email is deliberately switched off

The database is seeded with thirty six believable families, and believable means
addresses like `malia.kealoha@gmail.com` — addresses that may well belong to
somebody. `DEMO_DATA=1` is set on Vercel and on Render, and
`packages/core/src/email.ts` checks it before it checks anything else, returning
a refusal rather than throwing so the reason is recorded against the message and
shows in the console's Outbox.

To turn real email on, all three of these have to be true:

1. The database holds real people, not the seed.
2. `RESEND_API_KEY` is set and `EMAIL_TRANSPORT=resend`.
3. `DEMO_DATA` is cleared.

Doing (2) without (1) and (3) is the failure this guard exists to prevent.

## Re-seeding production

```bash
pnpm --filter @keiki/core exec tsx --env-file=../../.env.prod.local \
  scripts/seed.ts --snapshot --allow-remote-demo-data
```

`--allow-remote-demo-data` is required and deliberate: without it the seed
refuses to write invented families to anything that is not localhost.

## The pictures

Their school logos and programme images are Airtable attachment URLs, which are
signed and expire — the ones captured on 4 September were answering 410 Gone the
same evening. A fresh import against a new project therefore lands twenty nine
records with no picture. The bytes live in whichever environment copied them
while the links were alive, so they move across with:

```bash
pnpm --filter @keiki/core exec tsx --env-file=../../.env.prod.local \
  scripts/mirror-images.ts
```

It matches on name, uploads into the target project's public buckets, and
repoints the rows. Safe to run twice.

## Stripe

One webhook endpoint, test mode, pointed at the Vercel app:

```
https://keikicoders-registration.vercel.app/api/stripe/webhook
```

listening for `checkout.session.completed`, `checkout.session.expired`,
`refund.created`, `refund.updated`, `refund.failed`. Its signing secret is
`STRIPE_WEBHOOK_SECRET` on Vercel. The API service on Render has the Stripe
secret key but no webhook route; nothing there verifies signatures.

## What is not set up, and why

- **Render cron jobs.** They need a paid plan, and with `DEMO_DATA=1` they would
  have nothing to send. The definitions are in `render.yaml` and will work as
  written on a paid plan.
- **A custom domain.** The Vercel address is the address.
- **Analytics, GTM, SEO tags.** Left out on purpose rather than forgotten: URLs
  in this app contain class and family ids, and `Referrer-Policy:
  strict-origin-when-cross-origin` currently keeps those from third parties. A
  tag manager would hand them over. That is a decision for the client to make
  knowingly, not a config line to add quietly.
