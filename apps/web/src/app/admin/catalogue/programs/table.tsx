"use client";

import { AddRecord, EditableRow, type Field } from "../simple-form";
import { saveProgram, deleteProgram } from "../actions";
import { Pill } from "../../ui";
import type { ProgramRow } from "../queries";

const FIELDS: Field[] = [
  { name: "name", label: "Name", required: true, placeholder: "Code Heroes: Virtual Reality" },
  {
    name: "track",
    label: "Level",
    placeholder: "Code Heroes",
    hint: "Explorers, Juniors, Heroes, Masters. Shown as the tag on a class card.",
  },
  {
    name: "subject",
    label: "Subject",
    placeholder: "Virtual Reality",
    hint: "Decides the colour and the icon a family sees.",
  },
  { name: "imageUrl", label: "Image URL", type: "url" },
  { name: "description", label: "Description families read", type: "textarea" },
  { name: "active", label: "Offered", type: "checkbox" },
];

export function ProgramsTable({ rows }: { rows: ProgramRow[] }) {
  return (
    <>
      <div className="ops-panel">
        <div className="overflow-x-auto">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Program</th>
                <th>Level</th>
                <th>Subject</th>
                <th className="ops-num">Classes</th>
                <th className="ops-num">Campuses</th>
                <th>Offered</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <EditableRow
                  key={p.id}
                  columns={6}
                  idField="programId"
                  id={p.id}
                  fields={FIELDS}
                  save={saveProgram}
                  remove={deleteProgram}
                  removeLabel="Delete program"
                  values={{
                    name: p.name,
                    track: p.track,
                    subject: p.subject,
                    imageUrl: p.imageUrl,
                    description: p.description,
                    active: p.active,
                  }}
                  summary={
                    <span className="flex w-full flex-wrap items-center gap-x-6 gap-y-1">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-[var(--ops-muted)]">{p.track ?? ""}</span>
                      <span className="text-[var(--ops-muted)]">{p.subject ?? ""}</span>
                      <span className="ml-auto text-[var(--ops-muted)]">
                        {p.offerings} {p.offerings === 1 ? "class" : "classes"}
                      </span>
                      <span className="text-[var(--ops-muted)]">
                        {p.campuses} {p.campuses === 1 ? "campus" : "campuses"}
                      </span>
                      <Pill tone={p.active ? "good" : "quiet"}>
                        {p.active ? "offered" : "retired"}
                      </Pill>
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
          label="Add a program"
          idField="programId"
          fields={FIELDS}
          defaults={{ active: true }}
          save={saveProgram}
        />
      </div>
    </>
  );
}
