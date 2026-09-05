import { test, expect } from "@playwright/test";
import { sql, signInStaff, signUpParent, registerAndPay, freeClass, unique } from "./helpers";

/**
 * Dropping out, which is not the same event as asking for a refund.
 *
 * The build spec lists them separately: "kids sometimes join mid-semester, or
 * drop" is its own sentence, apart from cancellations and refunds. It is a
 * different thing operationally too. A cancellation is a family asking and
 * waiting on a decision, and it usually ends in money moving. A drop is the
 * office recording that a child stopped coming, which is often a phone call,
 * frequently involves no money at all because they attended eight of ten
 * sessions, and always needs the seat back today.
 *
 * Before this the only way to clear a roster was to approve a cancellation,
 * which meant refunding money nobody had asked for, or leaving the child and
 * their seat in place for the rest of the term. Both happened.
 */
test("dropping a child frees the seat, records why, and moves no money", async ({ page }) => {
  const cls = await freeClass(1);
  const email = `${unique("drop")}@example.test`;

  await signUpParent(page, email, "Drop Family");
  await registerAndPay(page, cls, {
    first: "Dropout",
    last: unique("Kid").replace(/-/g, ""),
    dob: "2016-03-03",
  });

  const [before] = await sql<{ seats_taken: number }[]>`
    select seats_taken from class_offerings where id = ${cls.id}`;

  const [enrollment] = await sql<{ id: string; child: string }[]>`
    select e.id, ch.first_name as child
      from enrollments e
      join children ch on ch.id = e.child_id
      join parents p on p.id = ch.parent_id
     where p.email = ${email} and e.class_offering_id = ${cls.id}`;
  expect(enrollment, "the registration landed").toBeTruthy();

  await signInStaff(page);
  await page.goto(`/admin/classes/${cls.id}/roster`);

  const row = page.locator("tr", { hasText: enrollment.child });
  await row.getByRole("button", { name: "Drop" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.locator("select[name=reasonCode]").selectOption("schedule_conflict");
  await dialog.locator("textarea[name=note]").fill("Dad rang, swim lessons moved to Tuesdays.");
  await dialog.getByRole("button", { name: "Drop from class" }).click();

  // The seat comes back immediately. That is the half the office actually needs
  // on the day, and the half that approving a cancellation was being abused for.
  await expect
    .poll(async () => {
      const [after] = await sql<{ seats_taken: number }[]>`
        select seats_taken from class_offerings where id = ${cls.id}`;
      return after.seats_taken;
    }, { timeout: 15_000 })
    .toBe(before.seats_taken - 1);

  const [row2] = await sql<
    {
      status: string;
      dropped_reason_code: string | null;
      dropped_note: string | null;
      dropped_by: string | null;
      refund_owed: boolean;
      refund_amount_cents: number | null;
      refunded_at: Date | null;
    }[]
  >`select status, dropped_reason_code, dropped_note, dropped_by,
           refund_owed, refund_amount_cents, refunded_at
      from enrollments where id = ${enrollment.id}`;

  expect(row2.status).toBe("dropped");
  expect(row2.dropped_reason_code).toBe("schedule_conflict");
  expect(row2.dropped_note).toContain("swim lessons");
  // Who did it, because "why is this child off the roster" is asked in February.
  expect(row2.dropped_by).toBe("ops@keikicoders.com");

  // And no money moved. This is the distinction the whole feature exists for:
  // a refund is a separate decision somebody makes on purpose, on Money.
  expect(row2.refund_owed, "a drop must not owe a refund by itself").toBe(false);
  expect(row2.refund_amount_cents).toBeNull();
  expect(row2.refunded_at).toBeNull();

  // It is on the audit trail rather than only in a column.
  const [event] = await sql<{ event: string }[]>`
    select event from enrollment_events
     where enrollment_id = ${enrollment.id} and event = 'dropped'`;
  expect(event, "the drop is on the enrollment's history").toBeTruthy();

  // The roster says so rather than simply losing them: a child who left is
  // exactly who somebody rings up about.
  await page.reload();
  await expect(page.locator("tr", { hasText: enrollment.child })).toContainText("dropped");
});

test("a child cannot be dropped twice, so the seat cannot be freed twice", async ({ page }) => {
  const cls = await freeClass(1);
  const email = `${unique("twice")}@example.test`;

  await signUpParent(page, email, "Double Family");
  await registerAndPay(page, cls, {
    first: "Double",
    last: unique("Drop").replace(/-/g, ""),
    dob: "2016-04-04",
  });

  const [enrollment] = await sql<{ id: string }[]>`
    select e.id from enrollments e
      join children ch on ch.id = e.child_id
      join parents p on p.id = ch.parent_id
     where p.email = ${email} and e.class_offering_id = ${cls.id}`;

  await signInStaff(page);

  // Straight at the action twice, rather than through the dialog: a double
  // click, a retried request and a refreshed tab all arrive here the same way.
  const post = () =>
    page.request.post(`/admin/classes/${cls.id}/roster`, {
      form: { enrollmentId: enrollment.id, reasonCode: "stopped_attending", note: "", fromSessionId: "" },
    });
  await post().catch(() => {});
  await post().catch(() => {});

  const [after] = await sql<{ seats_taken: number; enrolled: number }[]>`
    select c.seats_taken,
           (select count(*)::int from enrollments e
             where e.class_offering_id = c.id
               and e.status in ('active','cancellation_requested')) as enrolled
      from class_offerings c where c.id = ${cls.id}`;

  // Whatever those requests did, the invariant holds: the counter still equals
  // the places that are actually held.
  const [{ held }] = await sql<{ held: number }[]>`
    select count(*)::int as held from seat_holds where class_offering_id = ${cls.id}`;
  expect(after.seats_taken).toBe(after.enrolled + held);
  expect(after.seats_taken).toBeGreaterThanOrEqual(0);
});
