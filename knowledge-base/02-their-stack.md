# Keiki Coders: the system they run today

*Verbatim from their OnlineJobs posting 1719232, "Full-Stack (Next.js/Supabase) + Automation
(n8n/Airtable) Developer", captured 3 September 2026. The posting has since closed.*

## Their words

> Behind all of that is a system we built ourselves, and it's the reason our teachers can focus
> on students instead of spreadsheets. You'd own that system.

> **Since verified.** On 5 September their live site was read directly, and the
> details of how registration and the catalogue actually work are in
> `11-their-real-system.md`: the n8n webhook endpoints, the Fillout form's
> field-by-field contents, and where their business rules currently live. That
> document is concrete where this one is their own summary.

## The stack, as listed

| Layer | Tool | Their description |
|---|---|---|
| Operational source of truth | **Airtable** | students, programs, sessions, attendance, enrollment, invoicing, payroll |
| Workflow automation | **n8n**, self-hosted | enrollment processing, attendance tracking, invoice generation, payroll calculation, email campaigns, monitoring and alerts |
| Portals | **Softr** | teacher and parent portals, *"which we're outgrowing"* |
| Registration and payments | **Fillout + Stripe** | |
| Email marketing | **Brevo** | |
| Websites | multiple brand sites | Squarespace, confirmed by scraping keikicoders.com |
| Integrations | Gmail, Slack, QuickBooks, Gusto, Mosyle | |

## What they said the job actually is

Ranked in their own order:

1. **Build the next generation of products.** "This is the biggest part of the role. We're moving
   off no-code portals and building our own: a parent portal, a class and calendar system, and a
   custom registration and payments flow. You'd own that build, and the architecture decisions
   behind it."
2. **Own the system we have.** The Airtable and n8n operation runs the business today and keeps
   running while the new thing is built. Monitoring, alerting, catching failures before the
   operations team does, and fixing production issues live during program hours.
3. **Web and marketing systems.** Brand sites, landing pages for program launches, basic on-page
   SEO and analytics.
4. **General systems work.** Integrations, data migrations and cleanup, access management, and
   keeping documentation current in GitHub.

## The line that tells you what they value

> We'd rather hire a strong builder who can learn our automation stack than an automation
> specialist who can't build applications.

## Terms

- USD 1,200 to 1,600 a month, 40 hours
- Core window **6:00 AM to 12:00 PM Manila time**, every weekday, plus flexible async that
  sometimes lands on a weekend
- Explicit policy: **no time tracking, no screenshots, no activity monitors**
- Hiring process as originally posted: a short **paid trial task on their real system**, then a
  reference check

## The migration risk to raise with them

Airtable is the operational source of truth today and the new app will want to be. During any
overlap, one system has to own each entity or the data drifts. Dual-write is where projects of
this shape usually fail.
