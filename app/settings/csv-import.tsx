"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { buttonClass, Hint } from "../_components/ui";
import { IDLE_IMPORT_STATE, type ImportState } from "./csv-types";

export interface CsvImportLabels {
  preview: string;
  confirm: string;
  sizeHint: string;
  selectedFile: string;
}

/**
 * Import runs in two passes over the same file: preview validates and
 * reports, confirm writes. The file is sent again on confirm rather than
 * the page round-tripping the parsed CSV back through a hidden field,
 * which would make a large backup cross the Server Action body limit as
 * text on top of the original upload.
 *
 * The picked File is held in a ref because React 19 resets uncontrolled
 * form fields once a form action resolves — after the preview the
 * <input type="file"> is empty, so rebuilding FormData from the form
 * alone would submit no file at all.
 */
export function CsvImportForm({
  action,
  labels,
}: {
  action: (state: ImportState, formData: FormData) => Promise<ImportState>;
  labels: CsvImportLabels;
}) {
  const [state, dispatch, pending] = useActionState(action, IDLE_IMPORT_STATE);
  const pickedFile = useRef<File | null>(null);
  const [fileName, setFileName] = useState("");

  function commit() {
    const file = pickedFile.current;
    if (!file) return;
    const data = new FormData();
    data.set("file", file);
    data.set("commit", "1");
    // Dispatching outside a transition leaves `pending` stuck false, so
    // the confirm button would stay clickable during the write.
    startTransition(() => dispatch(data));
  }

  return (
    <form action={dispatch} className="space-y-2">
      <input
        type="file"
        name="file"
        accept=".csv,text/csv"
        required
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          pickedFile.current = file;
          setFileName(file?.name ?? "");
        }}
        className="file:rounded-control file:bg-sunken file:text-ink text-ink-muted block w-full text-sm file:mr-3 file:min-h-12 file:border-0 file:px-4 file:text-sm"
      />
      <button type="submit" disabled={pending} className={buttonClass("secondary", true)}>
        {labels.preview}
      </button>
      <Hint>{labels.sizeHint}</Hint>

      {state.message && (
        <p className={`text-sm ${state.status === "error" ? "text-negative" : "text-positive"}`}>
          {state.message}
        </p>
      )}

      {state.counts && (
        <p className="tnum text-sm">
          {state.counts.map((c) => `${c.label} ${c.value}`).join(" · ")}
        </p>
      )}

      {state.issues && state.issues.length > 0 && (
        <ul className="text-negative max-h-40 space-y-0.5 overflow-y-auto text-xs">
          {state.issues.map((issue, i) => (
            <li key={i}>
              {issue.label}: {issue.message}
            </li>
          ))}
        </ul>
      )}

      {state.status === "preview" && state.canCommit && (
        <div>
          <button
            type="button"
            onClick={commit}
            disabled={pending}
            className={buttonClass("primary", true)}
          >
            {labels.confirm}
          </button>
          {/* The picker looks empty at this point (React cleared it), so
              name the file the confirm button is actually going to use. */}
          <Hint>
            {labels.selectedFile}: {fileName}
          </Hint>
        </div>
      )}
    </form>
  );
}
