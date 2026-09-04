import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/uuid";
import { formatMoney } from "@/lib/stripe";
import RegisterForm from "./register-form";

export const dynamic = "force-dynamic";

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // A malformed id is a wrong address, not a server error. Without this the
  // uuid comparison below raises in Postgres and the page 500s.
  if (!isUuid(id)) notFound();

  const [cls] = await sql<
    {
      id: string;
      title: string;
      summary: string;
      school: string;
      weekday: number;
      start_time: string;
      end_time: string;
      weeks: number;
      capacity: number;
      seats_taken: number;
      price_cents: number;
    }[]
  >`select c.id, c.title, c.summary, s.name as school, c.weekday, c.start_time,
           c.end_time, c.weeks, c.capacity, c.seats_taken, c.price_cents
      from class_offerings c join schools s on s.id = c.school_id
     where c.id = ${id} and c.status = 'published'`;

  if (!cls) notFound();

  // Other classes the same parent might add in one submission, which is how the
  // "two kids, or two classes, one payment" path gets exercised.
  const others = await sql<
    { id: string; title: string; school: string; price_cents: number; left: number }[]
  >`select c.id, c.title, s.name as school, c.price_cents,
           (c.capacity - c.seats_taken) as left
      from class_offerings c join schools s on s.id = c.school_id
     where c.status = 'published' and c.id <> ${id} and c.seats_taken < c.capacity
     order by s.name limit 5`;

  const seatsLeft = cls.capacity - cls.seats_taken;

  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <div className="kc-card kc-enter p-7 sm:p-9">
        <p className="font-display text-xs font-semibold uppercase tracking-wider text-green-600">
          {cls.school}
        </p>
        <h1 className="mt-2 font-display text-4xl font-bold text-green-900">{cls.title}</h1>
        <p className="mt-3 text-ink-soft">{cls.summary}</p>

        <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 border-t border-hairline pt-5 text-sm">
          <div>
            <p className="text-ink-soft">When</p>
            <p className="font-display font-semibold">
              {DAYS[cls.weekday]}, {cls.weeks} weeks
            </p>
          </div>
          <div>
            <p className="text-ink-soft">Price per child</p>
            <p className="font-display font-semibold text-green-900">
              {formatMoney(cls.price_cents)}
            </p>
          </div>
          <div>
            <p className="text-ink-soft">Seats</p>
            <p
              className={`font-display font-semibold ${
                seatsLeft <= 3 ? "text-sun-deep" : "text-green-600"
              }`}
            >
              {seatsLeft} of {cls.capacity} left
            </p>
          </div>
        </div>
      </div>

      <RegisterForm
        classId={cls.id}
        classTitle={cls.title}
        priceCents={cls.price_cents}
        others={others}
      />
    </div>
  );
}
