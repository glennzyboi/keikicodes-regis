"use client";

import { useState } from "react";
import { Modal } from "@/components/modal";
import { RecordForm, type Field } from "./simple-form";
import { saveProgram, saveSchool, saveTerm } from "./catalogue-actions";

/**
 * The field definitions for the three reference records, in one place.
 *
 * They were duplicated across three table components, which is how a hint gets
 * fixed on the campus form and not on the one that adds a campus.
 *
 * Adding one is a dialog rather than a panel that pushes the table down. The
 * table is what somebody is reading; a form that shoves it two hundred pixels
 * down the page to make room is the behaviour that makes a console feel jumpy.
 *
 * **No picture fields here, on purpose.** They used to be "Image URL" and "Logo
 * URL" text boxes, which is not a field an office can fill in: the picture they
 * have is on a phone or in a shared folder, and "put it on a public URL first"
 * is the step where somebody gives up and leaves it blank. Pictures are uploaded
 * on the record own page, where the current one is visible at the size it will
 * actually appear, and they land in our own storage rather than as a link to
 * somebody else server that can rot.
 */

export const PROGRAM_FIELDS: Field[] = [
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
  { name: "description", label: "Description families read", type: "textarea" },
  { name: "active", label: "Offered", type: "checkbox" },
];

export const CAMPUS_FIELDS: Field[] = [
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
    hint: "Used for session times, and for deciding when the reminder job thinks it is today.",
  },
  {
    name: "externalRegistrationUrl",
    label: "Their own registration page",
    type: "url",
    hint: "Used when this campus enrolls families itself.",
  },
  { name: "active", label: "Listed to families", type: "checkbox" },
];

export const TERM_FIELDS: Field[] = [
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

function AddButton({
  label,
  title,
  idField,
  fields,
  defaults,
  save,
}: {
  label: string;
  title: string;
  idField: string;
  fields: Field[];
  defaults: Record<string, string | boolean | null>;
  save: Parameters<typeof RecordForm>[0]["save"];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="ops-btn ops-btn-primary" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <Modal title={title} tone="ops" onClose={() => setOpen(false)}>
          <RecordForm
            idField={idField}
            id={null}
            fields={fields}
            values={defaults}
            save={save}
            onDone={() => setOpen(false)}
          />
        </Modal>
      )}
    </>
  );
}

export function AddProgramButton() {
  return (
    <AddButton
      label="New program"
      title="Add a program"
      idField="programId"
      fields={PROGRAM_FIELDS}
      defaults={{ active: true }}
      save={saveProgram}
    />
  );
}

export function AddCampusButton() {
  return (
    <AddButton
      label="New campus"
      title="Add a campus"
      idField="schoolId"
      fields={CAMPUS_FIELDS}
      defaults={{ timezone: "Pacific/Honolulu", active: true }}
      save={saveSchool}
    />
  );
}

export function AddTermButton() {
  return (
    <AddButton
      label="New term"
      title="Add a term"
      idField="termId"
      fields={TERM_FIELDS}
      defaults={{}}
      save={saveTerm}
    />
  );
}
