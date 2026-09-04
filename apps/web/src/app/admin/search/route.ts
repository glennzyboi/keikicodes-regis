import { NextResponse } from "next/server";
import { sql } from "@keiki/core/db";
import { currentStaff } from "@/lib/staff-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the office is looking for, whatever they type.
 *
 * One box, four kinds of answer, because the question on the phone is never
 * "search the families table". It is "the Kealoha family", or "Tinker Lab", or
 * "that Nu'uanu class", and the person asking does not know or care which table
 * that lives in.
 *
 * Staff only, checked here rather than trusted from the browser: this returns
 * children's names and family email addresses, so it is exactly the endpoint
 * somebody would try unauthenticated.
 */

type Hit = {
  kind: "family" | "child" | "class" | "campus";
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

export async function GET(req: Request) {
  if (!(await currentStaff())) {
    return NextResponse.json({ error: "not_staff" }, { status: 401 });
  }

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  // Two characters is the point where results stop being the whole database.
  if (q.length < 2) return NextResponse.json({ hits: [] });

  // Capped, and the pattern is a bound parameter rather than interpolated, so
  // a percent sign somebody types is a percent sign and not a wildcard storm.
  const like = `%${q.toLowerCase().replace(/[%_]/g, (m) => `\\${m}`)}%`;

  const [families, children, classes, campuses] = await Promise.all([
    sql<{ id: string; full_name: string; email: string; kids: number }[]>`
      select p.id, p.full_name, p.email,
             (select count(*)::int from children c where c.parent_id = p.id) as kids
        from parents p
       where lower(p.full_name) like ${like} escape '\\'
          or lower(p.email::text) like ${like} escape '\\'
       order by p.full_name limit 6`,

    sql<{ id: string; name: string; parent_id: string; parent: string }[]>`
      select ch.id, ch.first_name || ' ' || ch.last_name as name,
             p.id as parent_id, p.full_name as parent
        from children ch join parents p on p.id = ch.parent_id
       where lower(ch.first_name || ' ' || ch.last_name) like ${like} escape '\\'
       order by ch.first_name limit 6`,

    sql<{ id: string; title: string; school: string; seats: string }[]>`
      select c.id, c.title, s.name as school,
             (c.seats_taken || '/' || c.capacity) as seats
        from class_offerings c join schools s on s.id = c.school_id
       where lower(c.title) like ${like} escape '\\'
          or lower(s.name) like ${like} escape '\\'
       order by s.name, c.title limit 6`,

    sql<{ id: string; name: string; slug: string; n: number }[]>`
      select s.id, s.name, s.slug,
             (select count(*)::int from class_offerings c where c.school_id = s.id) as n
        from schools s
       where lower(s.name) like ${like} escape '\\'
       order by s.name limit 4`,
  ]);

  const hits: Hit[] = [
    ...children.map((c) => ({
      kind: "child" as const,
      id: c.id,
      title: c.name,
      subtitle: `child of ${c.parent}`,
      href: `/admin/families/${c.parent_id}`,
    })),
    ...families.map((f) => ({
      kind: "family" as const,
      id: f.id,
      title: f.full_name,
      subtitle: `${f.email} · ${f.kids} ${f.kids === 1 ? "child" : "children"}`,
      href: `/admin/families/${f.id}`,
    })),
    ...classes.map((c) => ({
      kind: "class" as const,
      id: c.id,
      title: c.title,
      subtitle: `${c.school} · ${c.seats} seats`,
      href: `/admin/catalogue/classes/${c.id}`,
    })),
    ...campuses.map((s) => ({
      kind: "campus" as const,
      id: s.id,
      title: s.name,
      subtitle: `${s.n} ${s.n === 1 ? "class" : "classes"}`,
      href: `/admin/catalogue/classes?q=${encodeURIComponent(s.name)}`,
    })),
  ];

  return NextResponse.json({ hits });
}
