import type { ToolInput } from "./analysis-tools-types";

/**
 * What the model may ask the book for, and what it may propose.
 *
 * The screen sends its own figures and nothing else. Why 교통비 doubled
 * is not in that brief — the model asks for it, and only if the question
 * turns out to need it. Two things follow from that: most answers cost
 * one round trip and send nothing beyond the totals already on screen,
 * and when detail does leave, the reader is shown exactly which detail
 * and when it was asked for.
 *
 * The tools are deliberately few and narrow. Each is one question the
 * screens themselves can already answer, bounded to the reader's own
 * section by the caller — the model never names a section, an id or a
 * table, and cannot reach a row by guessing one.
 */
export const ANALYSIS_TOOLS = [
  {
    name: "read_transactions",
    description:
      "한 계정의 특정 기간 거래를 봅니다. 날짜·적요·메모·금액이 나옵니다. 어떤 항목이 왜 그렇게 됐는지 알아야 할 때만 쓰세요.",
    input_schema: {
      type: "object",
      properties: {
        account: { type: "string", description: "브리핑에 적힌 계정 이름 그대로" },
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["account", "from", "to"],
    },
  },
  {
    name: "read_months",
    description:
      "한 계정의 최근 몇 달 월별 합계를 봅니다. 이번 달이 평소와 다른지 보려면 이걸 쓰세요. 추측하지 말고 물어보십시오.",
    input_schema: {
      type: "object",
      properties: {
        account: { type: "string", description: "브리핑에 적힌 계정 이름 그대로" },
        months: { type: "integer", description: "1~24, 이번 달 포함" },
      },
      required: ["account", "months"],
    },
  },
  {
    name: "propose_budget",
    description:
      "예산 조정을 제안합니다. 바로 적용되지 않고 사람이 확인한 뒤 누릅니다. 바꿀 항목만 담으세요.",
    input_schema: {
      type: "object",
      properties: {
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              account: { type: "string" },
              amount: { type: "number", description: "새 예산, 화면에 보이는 단위 그대로" },
              why: { type: "string", description: "한 줄. 이 값이 예산 메모로 남습니다." },
            },
            required: ["account", "amount", "why"],
          },
        },
      },
      required: ["changes"],
    },
  },
] as const;

/** The longest window the model may ask to read, in days. */
export const READ_DAY_LIMIT = 400;
/** The most transactions one read returns. */
export const READ_ROW_LIMIT = 60;
/** The most months one read returns. */
export const READ_MONTH_LIMIT = 24;

export interface ReadTransactionsArgs {
  account: string;
  from: string;
  to: string;
}

export interface ReadMonthsArgs {
  account: string;
  months: number;
}

export interface ProposedChange {
  account: string;
  /** Major units, as the reader types them. */
  amount: number;
  why: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseReadTransactions(input: ToolInput): ReadTransactionsArgs | null {
  const account = typeof input.account === "string" ? input.account.trim() : "";
  const from = typeof input.from === "string" ? input.from : "";
  const to = typeof input.to === "string" ? input.to : "";
  if (!account || !DATE.test(from) || !DATE.test(to) || from > to) return null;

  // A window, not the whole book. The question is always about a period
  // the reader is looking at, and a model that asked for 2009 onwards
  // would be sending back years of entries nobody asked about.
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(days) || days > READ_DAY_LIMIT) return null;
  return { account, from, to };
}

export function parseReadMonths(input: ToolInput): ReadMonthsArgs | null {
  const account = typeof input.account === "string" ? input.account.trim() : "";
  const months = typeof input.months === "number" ? Math.floor(input.months) : NaN;
  if (!account || !Number.isFinite(months) || months < 1) return null;
  return { account, months: Math.min(months, READ_MONTH_LIMIT) };
}

export function parseProposal(input: ToolInput): ProposedChange[] | null {
  if (!Array.isArray(input.changes)) return null;
  const changes: ProposedChange[] = [];
  for (const raw of input.changes) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const account = typeof row.account === "string" ? row.account.trim() : "";
    const amount = typeof row.amount === "number" ? row.amount : NaN;
    const why = typeof row.why === "string" ? row.why.trim() : "";
    if (!account || !Number.isFinite(amount) || amount < 0) continue;
    changes.push({ account, amount, why });
  }
  return changes;
}

export type ResolvedAccount =
  { ok: true; id: string; name: string } | { ok: false; reason: "unknown" | "ambiguous" };

/**
 * A name back to an account, or a refusal.
 *
 * By name because the model is never given ids — it cannot reach a row
 * it was not shown. Two accounts may share a name (nothing in the schema
 * stops it), and a guess between them would write the right number onto
 * the wrong line, so that case is refused rather than resolved.
 */
export function resolveAccount(
  catalog: readonly { id: string; name: string }[],
  name: string,
): ResolvedAccount {
  const wanted = name.trim();
  const hits = catalog.filter((a) => a.name.trim() === wanted);
  if (hits.length === 1) return { ok: true, id: hits[0].id, name: hits[0].name };
  return { ok: false, reason: hits.length === 0 ? "unknown" : "ambiguous" };
}

/** How far past the current budget a proposal may go before it reads as a slip. */
export const PROPOSAL_MULTIPLE = 20;

/**
 * Whether a proposed figure is one a person could have meant.
 *
 * Only the obvious slips: a negative plan, and a decimal point in the
 * wrong place. The real guard is that nothing is written until the
 * reader presses 적용 — this only stops a nonsense row from reaching
 * that list and being pressed past.
 */
export function proposalFits(current: number | undefined, amount: number): boolean {
  if (!Number.isFinite(amount) || amount < 0) return false;
  if (current === undefined || current === 0) return true;
  return amount <= current * PROPOSAL_MULTIPLE;
}
