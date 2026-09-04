"use client";

import { AddRecord, EditableRow, type Field } from "../simple-form";
import { saveTerm, deleteTerm } from "../actions";
import { Pill } from "../../ui";
import type { TermRow } from "../queries";

const FIELDS: Field[] = [
  { name: "name", label: "Name", required: true, placeholder: "Spring 2027" },
  { name: "startsOn", label: "Starts", type: "date", required: true },
  { name: "endsOn", label: "Ends", type: "date", required: true },
  {
    name: "isCurrent",
    label: "This is the current term",
    type: "checkbox",
    hint: "Only one term can be current. Ticking this unticks whichever one is.",
  },
];

export function TermsTable({ rows }: { rows: TermRow[] }) {
  return (
    <>
      <div className="ops-panel">
        <div className="overflow-x-auto">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Term</th>
                <th>Starts</th>
                <th>Ends</th>
                <th className="ops-num">Classes</th>
                <th className="ops-num">Registered</th>
                <th>Current</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <EditableRow
                  key={t.id}
                  columns={6}
                  idField="termId"
                  id={t.id}
                  fields={FIELDS}
                  save={saveTerm}
                  remove={deleteTerm}
                  removeLabel="Delete term"
                  values={{
                    name: t.name,
                    startsOn: t.startsOn,
                    endsOn: t.endsOn,
                    isCurrent: t.isCurrent,
                  }}
                  summary={
                    <span className="flex w-full flex-wrap items-center gap-x-6 gap-y-1">
                      <span className="font-medium">{t.name}</span>
                      <span className="text-[var(--ops-muted)]">{t.startsOn}</span>
                      <span className="text-[var(--ops-muted)]">{t.endsOn}</span>
                      <span className="ml-auto text-[var(--ops-muted)]">
                        {t.offerings} {t.offerings === 1 ? "class" : "classes"}
                      </span>
                      <span className="text-[var(--ops-muted)]">{t.enrolled} registered</span>
                      {t.isCurrent && <Pill tone="good">current</Pill>}
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
          label="Add a term"
          idField="termId"
          fields={FIELDS}
          defaults={{}}
          save={saveTerm}
        />
      </div>
    </>
  );
}
