/**
 * A small RFC4180-ish CSV codec, hand-rolled rather than pulling in a
 * dependency — this app only ever reads/writes its own fixed-column
 * formats. Quoting is applied only to fields that need it (comma, quote,
 * or newline); parsing handles doubled-quote escaping and both \n and
 * \r\n line endings, and skips blank lines.
 */

export class CsvFormatError extends Error {}

/**
 * Prepended to every export so Excel (the most likely CSV consumer for a
 * Korean user) detects UTF-8 instead of misreading Hangul as CP949.
 * Stripped again on parse, since it would otherwise corrupt the first
 * header cell when one of our own exports is re-imported.
 */
export const UTF8_BOM = "\uFEFF";

function csvEscape(field: string): string {
  if (/[",\n\r]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export function toCsvText(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}

export function parseCsv(text: string): string[][] {
  const source = text.startsWith(UTF8_BOM) ? text.slice(UTF8_BOM.length) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let touchedRow = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
    touchedRow = false;
  };

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      touchedRow = true;
    } else if (char === ",") {
      touchedRow = true;
      pushField();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      if (touchedRow || field.length > 0) pushRow();
    } else {
      touchedRow = true;
      field += char;
    }
  }
  if (touchedRow || field.length > 0) pushRow();
  return rows;
}

function buildTable<C extends readonly string[]>(
  columns: C,
  rows: readonly Record<C[number], string>[],
): string {
  return (
    UTF8_BOM +
    toCsvText([[...columns], ...rows.map((r) => columns.map((col) => r[col as C[number]]))])
  );
}

/**
 * The header row is verified rather than skipped. Blindly dropping row 0
 * silently ate the first record of any file that didn't happen to carry
 * a header — for the accounts CSV that meant an account vanishing with
 * no error shown at all.
 */
function parseTable<C extends readonly string[]>(
  text: string,
  columns: C,
): Record<C[number], string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  const matchesHeader =
    header.length === columns.length && columns.every((col, i) => header[i] === col);
  if (!matchesHeader) {
    throw new CsvFormatError(`header_mismatch:${columns.join(",")}`);
  }

  return rows.slice(1).map((cols, i) => {
    if (cols.length !== columns.length) {
      throw new CsvFormatError(`column_count:${i + 2}:${columns.length}:${cols.length}`);
    }
    const record = {} as Record<C[number], string>;
    columns.forEach((col, idx) => {
      record[col as C[number]] = cols[idx];
    });
    return record;
  });
}

// ---- Transactions CSV ----
//
// One row per transaction line, grouped by transactionKey. Header-level
// fields (date/kind/title/memo) are repeated on every line of the same
// transaction; lineMemo is per-line. `side` is always the literal
// 'left'/'right' — a language-neutral structural value, unlike
// account/title/memo which are the user's own text — so a file exported
// under one UI locale still imports correctly after switching to the other.

export const TX_CSV_COLUMNS = [
  "transactionKey",
  "date",
  "kind",
  "title",
  "memo",
  "side",
  "account",
  "currency",
  "amount",
  "rate",
  "baseAmount",
  "lineMemo",
] as const;

export type TransactionCsvRow = Record<(typeof TX_CSV_COLUMNS)[number], string>;

export function buildTransactionsCsv(rows: readonly TransactionCsvRow[]): string {
  return buildTable(TX_CSV_COLUMNS, rows);
}

export function parseTransactionsCsv(text: string): TransactionCsvRow[] {
  return parseTable(text, TX_CSV_COLUMNS);
}

// ---- Accounts CSV ----

// `category` is appended rather than slotted next to `group`: header
// position is irrelevant to validation (the row must match exactly
// either way), and appending keeps the familiar prefix readable when
// the file is opened in a spreadsheet.
//
// `archived` gave way to the `activeFrom`/`activeTo` pair it was a lossy
// projection of — a boolean cannot say *when* an account stopped being
// used, and a backup that rounds a date down to true/false loses the
// answer for good. Blank on either end means unbounded.
//
// Changing these columns invalidates accounts.csv files exported before
// it, since parseTable rejects the whole file on a header mismatch. That
// cost is paid deliberately, as it was for `category`: silently dropping
// a field is the worse failure for a backup format.
export const ACCOUNT_CSV_COLUMNS = [
  "group",
  "name",
  "currency",
  "activeFrom",
  "activeTo",
  "memo",
  "category",
] as const;

export type AccountCsvRow = Record<(typeof ACCOUNT_CSV_COLUMNS)[number], string>;

export function buildAccountsCsv(rows: readonly AccountCsvRow[]): string {
  return buildTable(ACCOUNT_CSV_COLUMNS, rows);
}

export function parseAccountsCsv(text: string): AccountCsvRow[] {
  return parseTable(text, ACCOUNT_CSV_COLUMNS);
}

// ---- Budgets CSV ----

export const BUDGET_CSV_COLUMNS = ["account", "yearMonth", "amount"] as const;

export type BudgetCsvRow = Record<(typeof BUDGET_CSV_COLUMNS)[number], string>;

export function buildBudgetsCsv(rows: readonly BudgetCsvRow[]): string {
  return buildTable(BUDGET_CSV_COLUMNS, rows);
}

export function parseBudgetsCsv(text: string): BudgetCsvRow[] {
  return parseTable(text, BUDGET_CSV_COLUMNS);
}

// ---- Exchange rates CSV ----
//
// exchange_rates is a global table (no section column) — it is exported
// so a restore doesn't lose manually corrected rates, which cannot be
// re-derived from the API.

export const RATE_CSV_COLUMNS = ["date", "base", "quote", "rate", "source"] as const;

export type RateCsvRow = Record<(typeof RATE_CSV_COLUMNS)[number], string>;

export function buildRatesCsv(rows: readonly RateCsvRow[]): string {
  return buildTable(RATE_CSV_COLUMNS, rows);
}

export function parseRatesCsv(text: string): RateCsvRow[] {
  return parseTable(text, RATE_CSV_COLUMNS);
}
