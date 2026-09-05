import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sql } from "@keiki/core/db";
import { isUuid } from "@keiki/core/uuid";
import { POLICY_VERSION } from "@keiki/core/policies";
import { currentParent } from "@/lib/parent-auth";
import { formatMoney } from "@keiki/core/stripe";
import { offeringById, isoDate } from "@/lib/catalogue";
import RegisterForm from "./register-form";

export const dynamic = "force-dynamic";

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

export default async function RegisterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // A malformed id is a wrong address, not a server error. Without this the
  // uuid comparison below raises in Postgres and the page 500s.
  if (!isUuid(id)) notFound();

  // Registration needs an account. Sending them to sign in with next= set means
  // they land back on this exact class rather than the catalogue, which is the
  // difference between a login wall and a dead end.
  const parent = await currentParent();
  if (!parent) redirect(`/login?next=${encodeURIComponent(`/register/${id}`)}`);

  const cls = await offeringById(id);
  if (!cls || cls.status !== "published") notFound();

  // A class the campus enrols itself has no payment page here. Reaching this
  // URL directly is answered with the truth and a way onwards, not a 404.
  if (cls.registrationMode === "external") {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16">
        <div className="kc-card kc-enter p-8 text-center">
          <p className="font-display text-xs font-semibold uppercase tracking-wider text-green-600">
            {cls.school}
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold text-green-900">{cls.title}</h1>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-ink-soft">
            {cls.school} takes registrations for this class through their own office. We
            teach it; they enroll for it, so signing up here would not get your child a
            place.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            {cls.externalUrl && (
              <a
                href={cls.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="kc-btn kc-btn-primary text-sm"
              >
                Register at {cls.school}
              </a>
            )}
            <Link href={`/schools/${cls.schoolSlug}`} className="kc-btn kc-btn-quiet text-sm">
              Other classes at {cls.school}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Children already on file. A family registering for a second term picks from
  // this instead of retyping everything, which is the single biggest difference
  // between this and the form they use today.
  const existingChildren = await sql<
    {
      id: string;
      first_name: string;
      last_name: string;
      date_of_birth: string;
      grade: number | null;
      notes: string | null;
      photo_path: string | null;
      in_afterschool_care: boolean;
      afterschool_care_program: string | null;
    }[]
  >`select id, first_name, last_name, date_of_birth, grade, notes, photo_path,
           in_afterschool_care, afterschool_care_program
      from children where parent_id = ${parent.id}
     order by first_name`;

  const [guardian] = await sql<
    { full_name: string; email: string | null; phone: string | null; relation: string | null }[]
  >`select full_name, email, phone, relation from guardians
     where parent_id = ${parent.id} order by created_at limit 1`;

  const [consented] = await sql<{ policy_version: string }[]>`
    select policy_version from consents
     where parent_id = ${parent.id} and kind = 'participation_policies'
       and policy_version = ${POLICY_VERSION}`;

  // Other classes the same parent might add in one submission, which is how the
  // "two kids, or two classes, one payment" path gets exercised.
  //
  // Only ones we actually sell, and only at the same campus: adding a class at
  // a different school to the same order would mean a second pickup, which is
  // the one thing their whole model avoids.
  //
  // classes_clash is evaluated here rather than in the browser, so a class that
  // cannot be combined with this one arrives already marked. The server rejects
  // it too; this just means the parent never gets far enough to be rejected.
  const others = await sql<
    {
      id: string;
      title: string;
      school: string;
      price_cents: number;
      left: number;
      weekday: number;
      start_time: string;
      end_time: string;
      grade_min: number | null;
      grade_max: number | null;
      clashes: boolean;
    }[]
  >`select c.id, c.title, s.name as school, c.price_cents,
           (c.capacity - c.seats_taken) as left,
           c.weekday, c.start_time, c.end_time, c.grade_min, c.grade_max,
           classes_clash(c.id, ${id}) as clashes
      from class_offerings c join schools s on s.id = c.school_id
     where c.status = 'published' and c.id <> ${id}
       and c.registration_mode = 'keiki_coders'
       and c.seats_taken < c.capacity
       and c.school_id = ${cls.schoolId}
     order by clashes asc, c.weekday limit 6`;

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <Link href={`/schools/${cls.schoolSlug}`} className="kc-back">
        <span aria-hidden>&larr;</span> {cls.school}
      </Link>

      <div className="kc-card kc-enter mt-4 p-7 sm:p-9">
        <p className="font-display text-xs font-semibold uppercase tracking-wider text-green-600">
          {cls.school}
          {cls.track ? ` · ${cls.track}` : ""}
        </p>
        <h1 className="mt-2 font-display text-4xl font-bold leading-tight text-green-900">
          {cls.title}
        </h1>
        {cls.description && <p className="mt-3 text-ink-soft">{cls.description}</p>}

        <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 border-t border-hairline pt-5 text-sm">
          <div>
            <p className="text-ink-soft">When</p>
            <p className="font-display font-semibold">
              {DAYS[cls.weekday]}, {cls.sessionCount} sessions
            </p>
          </div>
          {cls.gradeLabel && (
            <div>
              <p className="text-ink-soft">Grades</p>
              <p className="font-display font-semibold">{cls.gradeLabel}</p>
            </div>
          )}
          <div>
            <p className="text-ink-soft">Price per child</p>
            <p className="font-display font-semibold text-green-900">
              {formatMoney(cls.priceCents ?? 0)}
            </p>
          </div>
          <div>
            <p className="text-ink-soft">Seats</p>
            <p
              className={`font-display font-semibold ${
                cls.seatsLeft <= 3 ? "text-sun-deep" : "text-green-600"
              }`}
            >
              {cls.seatsLeft} of {cls.capacity} left
            </p>
          </div>
        </div>
      </div>

      <RegisterForm
        parentId={parent.id}
        parentName={parent.fullName}
        parentEmail={parent.email}
        parentPhone={parent.phone}
        classId={cls.id}
        classTitle={cls.title}
        classSchool={cls.school}
        priceCents={cls.priceCents ?? 0}
        gradeMin={cls.gradeMin}
        gradeMax={cls.gradeMax}
        others={others}
        existingChildren={existingChildren.map((c) => ({
          id: c.id,
          firstName: c.first_name,
          lastName: c.last_name,
          dateOfBirth: isoDate(c.date_of_birth) ?? "",
          grade: c.grade,
          notes: c.notes ?? "",
          photoPath: c.photo_path,
          inAfterschoolCare: c.in_afterschool_care,
          afterschoolCareProgram: c.afterschool_care_program ?? "",
        }))}
        existingGuardian={
          guardian
            ? {
                fullName: guardian.full_name,
                email: guardian.email ?? "",
                phone: guardian.phone ?? "",
                relation: guardian.relation ?? "",
              }
            : null
        }
        alreadyConsented={Boolean(consented)}
        policyVersion={POLICY_VERSION}
      />
    </div>
  );
}
