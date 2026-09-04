"use client";

import { AddRecord, EditableRow, type Field } from "../simple-form";
import { saveSchool, deleteSchool } from "../actions";
import { Pill } from "../../ui";
import type { SchoolRow } from "../queries";

const FIELDS: Field[] = [
  { name: "name", label: "Name", required: true },
  {
    name: "kind",
    label: "Kind",
    type: "select",
    options: [
      { value: "", label: "Not set" },
      { value: "public", label: "Public" },
      { value: "private", label: "Private" },
      { value: "charter", label: "Charter" },
    ],
  },
  { name: "area", label: "Area", placeholder: "Honolulu" },
  {
    name: "timezone",
    label: "Timezone",
    required: true,
    hint: "Used for session times and for deciding when the reminder job thinks it is today.",
  },
  { name: "logoUrl", label: "Logo URL", type: "url" },
  {
    name: "externalRegistrationUrl",
    label: "Their own registration page",
    type: "url",
    hint: "Used when this campus enrols families itself.",
  },
  { name: "active", label: "Listed to families", type: "checkbox" },
];

export function SchoolsTable({ rows }: { rows: SchoolRow[] }) {
  return (
    <>
      <div className="ops-panel">
        <div className="overflow-x-auto">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Campus</th>
                <th>Kind</th>
                <th>Area</th>
                <th className="ops-num">Classes</th>
                <th className="ops-num">Registered</th>
                <th>Listed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <EditableRow
                  key={s.id}
                  columns={6}
                  idField="schoolId"
                  id={s.id}
                  fields={FIELDS}
                  save={saveSchool}
                  remove={deleteSchool}
                  removeLabel="Delete campus"
                  values={{
                    name: s.name,
                    kind: s.kind,
                    area: s.area,
                    timezone: s.timezone,
                    logoUrl: s.logoUrl,
                    externalRegistrationUrl: s.externalUrl,
                    active: s.active,
                  }}
                  summary={
                    <span className="flex w-full flex-wrap items-center gap-x-6 gap-y-1">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-[var(--ops-muted)]">{s.kind ?? "kind not set"}</span>
                      <span className="text-[var(--ops-muted)]">{s.area ?? ""}</span>
                      <span className="ml-auto text-[var(--ops-muted)]">
                        {s.published} of {s.offerings} published
                      </span>
                      <span className="text-[var(--ops-muted)]">{s.enrolled} registered</span>
                      <Pill tone={s.active ? "good" : "quiet"}>{s.active ? "listed" : "hidden"}</Pill>
                    </span>
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4">
        <AddRecord
          label="Add a campus"
          idField="schoolId"
          fields={FIELDS}
          defaults={{ timezone: "Pacific/Honolulu", active: true }}
          save={saveSchool}
        />
      </div>
    </>
  );
}
