"use client";

import { useActionState, useState } from "react";
import { ExpandableRow } from "@/components/expandable";

/**
 * The three small catalogue editors: campuses, programs and terms.
 *
 * They share a shape, so they share a component. Each row opens into its own
 * form rather than navigating to a page, because these are one field edits
 * almost every time: renaming a campus, retiring a program, marking which term
 * is current. Making somebody load a page, edit, save and come back for that is
 * how a tool starts losing to a spreadsheet.
 */

export type Field = {
  name: string;
  label: string;
  type?: "text" | "url" | "date" | "textarea" | "select" | "checkbox";
  options?: { value: string; label: string }[];
  hint?: string;
  required?: boolean;
  placeholder?: string;
};

type ActionResult = { ok: true; message: string } | { ok: false; error: string } | null;
type Action = (prev: unknown, formData: FormData) => Promise<Exclude<ActionResult, null>>;

function Control({ field, value }: { field: Field; value: string | boolean | null }) {
  const common = { name: field.name, id: field.name, className: "ops-field w-full" };

  if (field.type === "checkbox") {
    return (
      <label className="flex items-center gap-2.5">
        <input type="checkbox" name={field.name} defaultChecked={Boolean(value)} />
        <span>{field.label}</span>
      </label>
    );
  }

  return (
    <label className="block">
      <span className="ops-label">{field.label}</span>
      {field.type === "textarea" ? (
        <textarea {...common} rows={3} defaultValue={String(value ?? "")} />
      ) : field.type === "select" ? (
        <select {...common} defaultValue={String(value ?? "")}>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...common}
          type={field.type === "date" ? "date" : field.type === "url" ? "url" : "text"}
          required={field.required}
          placeholder={field.placeholder}
          defaultValue={String(value ?? "")}
        />
      )}
      {field.hint && <span className="mt-1 block text-[var(--ops-muted)]">{field.hint}</span>}
    </label>
  );
}

/**
 * One record's form.
 *
 * The result stays on screen rather than the panel closing itself. Closing on
 * success felt tidy and meant somebody who added a campus was told nothing at
 * all: the panel vanished, the row appeared somewhere in a table of twenty, and
 * the only way to know it had worked was to go looking. The test caught it,
 * which is a fair argument for driving the real UI rather than the action.
 */
export function RecordForm({
  idField,
  id,
  fields,
  values,
  save,
  remove,
  removeLabel,
  onDone,
}: {
  idField: string;
  id: string | null;
  fields: Field[];
  values: Record<string, string | boolean | null>;
  save: Action;
  remove?: Action;
  removeLabel?: string;
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(save, null as ActionResult);
  const [removeState, removeAction, removing] = useActionState(
    remove ?? (async () => ({ ok: false as const, error: "not available" })),
    null as ActionResult,
  );

  return (
    <div className="space-y-3">
      <form action={action} className="space-y-3">
        {id && <input type="hidden" name={idField} value={id} />}
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.name} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
              <Control field={f} value={values[f.name] ?? null} />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button className="ops-btn ops-btn-primary" disabled={pending}>
            {pending ? "Saving..." : id ? "Save" : "Add"}
          </button>
          {state && (
            <span className={state.ok ? "ops-ok" : "ops-warn"} role="status">
              {state.ok ? state.message : state.error}
            </span>
          )}
          {state?.ok && onDone && (
            <button type="button" className="ops-btn" onClick={onDone}>
              Done
            </button>
          )}
        </div>
      </form>

      {remove && id && (
        <form action={removeAction} className="border-t border-[var(--ops-line)] pt-3">
          <input type="hidden" name={idField} value={id} />
          <button className="ops-btn ops-btn-danger" disabled={removing}>
            {removeLabel ?? "Remove"}
          </button>
          {removeState && !removeState.ok && (
            <span className="ops-warn ml-2" role="status">
              {removeState.error}
            </span>
          )}
        </form>
      )}
    </div>
  );
}

/** A row that opens into its editor. */
export function EditableRow({
  summary,
  columns,
  idField,
  id,
  fields,
  values,
  save,
  remove,
  removeLabel,
}: {
  summary: React.ReactNode;
  columns: number;
  idField: string;
  id: string;
  fields: Field[];
  values: Record<string, string | boolean | null>;
  save: Action;
  remove?: Action;
  removeLabel?: string;
}) {
  return (
    <ExpandableRow
      columns={columns}
      summary={summary}
      detail={
        <RecordForm
          idField={idField}
          id={id}
          fields={fields}
          values={values}
          save={save}
          remove={remove}
          removeLabel={removeLabel}
        />
      }
    />
  );
}

/** The "add one" panel, closed until it is wanted. */
export function AddRecord({
  label,
  idField,
  fields,
  defaults,
  save,
}: {
  label: string;
  idField: string;
  fields: Field[];
  defaults: Record<string, string | boolean | null>;
  save: Action;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button className="ops-btn" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  return (
    <div className="ops-panel p-4">
      <div className="flex items-center justify-between">
        <h2 className="ops-panel-head">{label}</h2>
        <button className="ops-btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <div className="mt-3">
        <RecordForm
          idField={idField}
          id={null}
          fields={fields}
          values={defaults}
          save={save}
          onDone={() => setOpen(false)}
        />
      </div>
    </div>
  );
}
