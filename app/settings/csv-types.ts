/**
 * Shared between the CSV server actions and the client form. Kept out of
 * csv-actions.ts because a "use server" module may only export async
 * functions — exporting the initial-state constant from there is a
 * runtime error, not just a lint nit.
 */
export interface ImportState {
  status: "idle" | "error" | "preview" | "done";
  /** Localized on the server; the client renders it verbatim. */
  message?: string;
  counts?: { label: string; value: number }[];
  issues?: { label: string; message: string }[];
  canCommit?: boolean;
}

export const IDLE_IMPORT_STATE: ImportState = { status: "idle" };
