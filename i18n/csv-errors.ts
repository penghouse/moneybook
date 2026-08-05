import type { ImportIssue, ImportIssueCode } from "@/lib/csv-import";
import { CsvFormatError } from "@/lib/csv";
import type { TranslationKey } from "./index";
import { interpolate, type Translate } from "./format";

const ISSUE_KEY: Record<ImportIssueCode, TranslationKey> = {
  emptyName: "csvError.emptyName",
  invalidGroup: "csvError.invalidGroup",
  invalidCurrency: "csvError.invalidCurrency",
  duplicateInFile: "csvError.duplicateInFile",
  invalidDate: "csvError.invalidDate",
  invalidYearMonth: "csvError.invalidYearMonth",
  invalidKind: "csvError.invalidKind",
  invalidSource: "csvError.invalidSource",
  tooFewLines: "csvError.tooFewLines",
  invalidSide: "csvError.invalidSide",
  unknownAccount: "csvError.unknownAccount",
  currencyMismatch: "csvError.currencyMismatch",
  accountGroupMismatch: "csvError.accountGroupMismatch",
  ambiguousGroup: "csvError.ambiguousGroup",
  activeRange: "csvError.activeRange",
  invalidAmount: "csvError.invalidAmount",
  invalidRate: "csvError.invalidRate",
  invalidBaseAmount: "csvError.invalidBaseAmount",
  unbalanced: "csvError.unbalanced",
};

/**
 * Import problems are localized on the server, where the dictionary
 * lives, so the client component only ever receives display-ready text.
 */
export function formatImportIssue(t: Translate, issue: ImportIssue): string {
  const template = t(ISSUE_KEY[issue.code]);
  const params: Record<string, string> = {};
  if ("value" in issue) params.value = issue.value;
  if ("expected" in issue) params.expected = issue.expected;
  // This one's `expected` is a group code, not text to show — the reader
  // needs "부채", not "liability".
  if (issue.code === "accountGroupMismatch") params.expected = t(`group.${issue.expected}`);
  const text = interpolate(template, params);
  // assertBalanced's own message names which invariant broke (totals, or
  // amount*rate vs baseAmount); it is appended verbatim as a diagnostic
  // rather than translated, since it describes an internal check.
  return issue.code === "unbalanced" && issue.detail ? `${text} (${issue.detail})` : text;
}

/** Structural problems with the file itself, raised before any row is validated. */
export function formatCsvFormatError(t: Translate, error: unknown): string {
  if (!(error instanceof CsvFormatError)) return t("csvError.parseFailed");

  const [kind, ...rest] = error.message.split(":");
  if (kind === "header_mismatch") {
    return interpolate(t("csvError.headerMismatch"), { value: rest.join(":") });
  }
  if (kind === "column_count") {
    const [rowNumber, expected] = rest;
    return interpolate(t("csvError.columnCount"), { value: rowNumber, expected });
  }
  return t("csvError.parseFailed");
}
