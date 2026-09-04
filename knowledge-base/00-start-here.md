# Start here

Client work for **Keiki Coders**, a Hawaii kids coding company. Glenn applied for
their Full-Stack plus Automation Developer role, and this folder is the **paid
trial task** that decides it.

**Deadline: 9 September 2026. Target 8 September.**

---

## Read in this order

1. **`08-build-status.md`** the goal, how to run it, what is built, what is
   tested, every bug found, what is left. Start here, always.
2. **`04-the-brief.md`** the assignment verbatim. Never work from a paraphrase.
3. **`11-their-real-system.md`** how their registration actually works today,
   read off their live site. This is the reason the schema looks the way it
   does, and it is the strongest material in the whole folder for the Loom.
4. **`09-their-questions.md`** answers to all seven questions they said they
   would ask, written against what is actually built and verified.
5. **`10-test-it-yourself.md`** logins, the test card, and the things to try in
   order. Use this to drive the system by hand.

## Reference

- `02-their-stack.md` what they run today and what the job actually is
- `06-brand-tokens.md` their real colours and typefaces, scraped from their site
- `01-company.md`, `03-people.md`, `05-hiring-thread.md`, `07-open-questions.md`

The older overall plan and the first Loom script are one folder up at
`../keiki-build-plan.html`. **Its section 08 script is badly out of date**: it
predates parent accounts, the notifications outbox, the calendars, the console
restructure, and everything learned from their real catalogue. Section 10 still
holds the unsent reply to Peter.

---

## State as of 5 September 2026

Built as a pnpm workspace: a domain package with no framework in it, an API
service, and the Next.js site. Running locally, covered by **100 passing tests**
across auth, deliberate abuse, the catalogue, the public API, every console tab,
the parent journey and the background jobs. Two consecutive full runs green,
every database invariant clean.

It runs on **their real catalogue**: 19 campuses, 10 programs, 28 offerings
imported from their own live endpoints, with the 15 that partner schools enrol
themselves correctly marked as not ours to sell.

Not yet done: **record the Loom**, **send the reply to Peter**, and get Glenn's
**Wise details**. Google sign in and Resend are wired but need credentials.
Details in `08-build-status.md`.
