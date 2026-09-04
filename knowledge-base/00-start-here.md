# Start here

Client work for **Keiki Coders**, a Hawaii kids coding company. Glenn applied for
their Full-Stack plus Automation Developer role, and this folder is the **paid
trial task** that decides it.

**Deadline: 9 September 2026. Target 8 September.**

---

## Read in this order

1. **`08-build-status.md`** THE GOAL, how to run it, what is built, what is
   tested, every bug found, what is left. Start here, always.
2. **`04-the-brief.md`** the assignment verbatim. Never work from a paraphrase.
3. **`09-their-questions.md`** answers to all seven questions they said they
   would ask, written against what is actually built and verified. This is the
   source for the walkthrough, not the older plan document.
4. **`10-test-it-yourself.md`** logins, the test card, and nine things to try in
   order. Use this to drive the system by hand.

## Reference

- `02-their-stack.md` what they run today and what the job actually is
- `06-brand-tokens.md` their real colours and typefaces, scraped from their site
- `01-company.md`, `03-people.md`, `05-hiring-thread.md`, `07-open-questions.md`

The older overall plan and the first Loom script are one folder up at
`../keiki-build-plan.html`. **Its section 08 script is out of date**: it predates
parent accounts, the notifications outbox, the calendars and the console
restructure. Section 10 still holds the unsent reply to Peter.

---

## State as of 4 September 2026

Built, running locally, and covered by **61 passing tests** across auth,
deliberate abuse, every admin tab, the parent journey, and the background jobs.
Two consecutive full runs green, every database invariant clean.

Not yet done: **record the Loom**, and decide what to do about the one
decorative search box in the console. Google sign in and Resend are wired but
need credentials. Details in `08-build-status.md`.
