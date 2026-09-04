"use client";

import { useRef, useState } from "react";
import { addSupportNote } from "../../actions";

/**
 * Log what happened.
 *
 * Kind first, because "complaint" and "note" get read differently three weeks
 * later. Optionally about one child, since most calls are about one of them
 * rather than the family in general.
 */
export function AddNote({
  parentId,
  keiki,
}: {
  parentId: string;
  // Not called "children": that is React's own prop name, and shadowing it here
  // makes the JSX below read as if the component takes child elements.
  keiki: { child_id: string; first_name: string; last_name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  if (!open) {
    return (
      <button className="ops-btn w-full" onClick={() => setOpen(true)}>
        Log a call or a note
      </button>
    );
  }

  return (
    <form
      ref={form}
      action={async (data) => {
        await addSupportNote(data);
        form.current?.reset();
        setOpen(false);
      }}
      className="space-y-2.5"
    >
      <input type="hidden" name="parentId" value={parentId} />

      <div className="flex flex-wrap gap-2">
        <select name="kind" className="ops-field" aria-label="Kind of note" defaultValue="call">
          <option value="call">Phone call</option>
          <option value="email">Email</option>
          <option value="note">Note</option>
          <option value="complaint">Complaint</option>
          <option value="resolved">Resolved</option>
        </select>

        {keiki.length > 0 && (
          <select name="childId" className="ops-field" aria-label="About which child" defaultValue="">
            <option value="">Whole family</option>
            {keiki.map((c) => (
              <option key={c.child_id} value={c.child_id}>
                {c.first_name} {c.last_name}
              </option>
            ))}
          </select>
        )}
      </div>

      <textarea
        name="body"
        required
        rows={3}
        className="ops-field w-full"
        style={{ height: "auto", paddingTop: 8, paddingBottom: 8 }}
        placeholder="Mum called about a swim clash on Tuesdays. Agreed to move Kaimana to the Thursday class from week 4."
      />

      <div className="flex justify-end gap-2">
        <button type="button" className="ops-btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button className="ops-btn ops-btn-primary">Save note</button>
      </div>
    </form>
  );
}
