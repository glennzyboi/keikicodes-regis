"use client";

import { useState } from "react";
import { Modal } from "@/components/modal";
import { RecordForm } from "./simple-form";
import { PROGRAM_FIELDS, CAMPUS_FIELDS, TERM_FIELDS } from "./setup-forms";
import {
  saveProgram,
  deleteProgram,
  saveSchool,
  deleteSchool,
  saveTerm,
  deleteTerm,
} from "./catalogue-actions";

/**
 * Editing a reference record, from its own page.
 *
 * These used to be rows that expanded in place inside the table. That was the
 * right call when the table was the only screen, and it is the wrong one now
 * that each record has a page: a row that both navigates and expands is a click
 * that means two things, and the expanded form pushed every row below it down
 * the page while you typed.
 *
 * A dialog, because the delete guard's refusal ("14 classes still run at this
 * campus") needs somewhere to be read that is not a table cell.
 */

function EditButton({
  title,
  idField,
  id,
  fields,
  values,
  save,
  remove,
  removeLabel,
}: {
  title: string;
  idField: string;
  id: string;
  fields: Parameters<typeof RecordForm>[0]["fields"];
  values: Record<string, string | boolean | null>;
  save: Parameters<typeof RecordForm>[0]["save"];
  remove: Parameters<typeof RecordForm>[0]["save"];
  removeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ops-btn" onClick={() => setOpen(true)}>
        Edit
      </button>
      {open && (
        <Modal title={title} tone="ops" onClose={() => setOpen(false)}>
          <RecordForm
            idField={idField}
            id={id}
            fields={fields}
            values={values}
            save={save}
            remove={remove}
            removeLabel={removeLabel}
            onDone={() => setOpen(false)}
          />
        </Modal>
      )}
    </>
  );
}

export function EditProgram({
  program,
}: {
  program: {
    id: string;
    name: string;
    track: string | null;
    subject: string | null;
    description: string | null;
    active: boolean;
  };
}) {
  return (
    <EditButton
      title={`Edit ${program.name}`}
      idField="programId"
      id={program.id}
      fields={PROGRAM_FIELDS}
      values={{
        name: program.name,
        track: program.track,
        subject: program.subject,
        description: program.description,
        active: program.active,
      }}
      save={saveProgram}
      remove={deleteProgram}
      removeLabel="Delete program"
    />
  );
}

export function EditCampus({
  campus,
}: {
  campus: {
    id: string;
    name: string;
    kind: string | null;
    area: string | null;
    timezone: string;
    externalUrl: string | null;
    active: boolean;
  };
}) {
  return (
    <EditButton
      title={`Edit ${campus.name}`}
      idField="schoolId"
      id={campus.id}
      fields={CAMPUS_FIELDS}
      values={{
        name: campus.name,
        kind: campus.kind,
        area: campus.area,
        timezone: campus.timezone,
        externalRegistrationUrl: campus.externalUrl,
        active: campus.active,
      }}
      save={saveSchool}
      remove={deleteSchool}
      removeLabel="Delete campus"
    />
  );
}

export function EditTerm({
  term,
}: {
  term: {
    id: string;
    name: string;
    startsOn: string;
    endsOn: string;
    isCurrent: boolean;
  };
}) {
  return (
    <EditButton
      title={`Edit ${term.name}`}
      idField="termId"
      id={term.id}
      fields={TERM_FIELDS}
      values={{
        name: term.name,
        startsOn: term.startsOn,
        endsOn: term.endsOn,
        isCurrent: term.isCurrent,
      }}
      save={saveTerm}
      remove={deleteTerm}
      removeLabel="Delete term"
    />
  );
}
