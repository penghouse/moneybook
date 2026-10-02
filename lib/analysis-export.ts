import type { YearOverview } from "./year-overview";
import { monthAchievement, yearAchievements } from "./year-overview";

/**
 * The whole book as one file to hand an assistant.
 *
 * Not the CSV backup. That one carries every transaction and nothing
 * about the plans, because it exists to rebuild the book — this one
 * exists to be read, so it carries the shape of the year, what was
 * planned, what was written on the plans, and only the recent entries.
 *
 * Everything here is text on purpose. A model reading a table does not
 * need it to be valid CSV; it needs to be able to tell, without being
 * told twice, which figures the ledger stands behind and which are a
 * plan that has not happened yet. That distinction is the single thing
 * this file is most careful about.
 */

export interface ExportAccount {
  name: string;
  group: string;
  category: string | null;
}

export interface ExportTransaction {
  date: string;
  title: string;
  memo: string | null;
  /** '식비 ← 신용카드', already joined by the caller. */
  flow: string;
  amount: string;
}

export interface ExportBudgetNote {
  periodKey: string;
  account: string;
  amount: string;
  note: string;
}

export interface ExportFormula {
  scope: string;
  name: string;
  value: string;
}

export interface ExportBalance {
  group: string;
  name: string;
  amount: string;
}

export interface AnalysisExport {
  generatedAt: string;
  currency: string;
  timezone: string;
  /** 'YYYY-MM' — the month the book is in. */
  currentMonth: string;
  year: string;
  overview: YearOverview;
  /** Formatted by the caller, in the same units the screens show. */
  money: (minor: number) => string;
  groupLabel: (group: string) => string;
  accounts: readonly ExportAccount[];
  balances: readonly ExportBalance[];
  budgetNotes: readonly ExportBudgetNote[];
  formulas: readonly ExportFormula[];
  transactions: readonly ExportTransaction[];
  transactionsFrom: string;
  transactionsTo: string;
}

const percent = (rate: number) => `${Math.round(rate * 1000) / 10}%`;

/**
 * Where the ledger stops and the plan begins, said once.
 *
 * Marking every cell would be noise on a hundred and eighty of them. The
 * boundary is one sentence, and only the exception to it — the month in
 * progress, which reads from its budget unless the ledger has already
 * passed it — needs a mark of its own.
 */
function readingNote(data: AnalysisExport): string[] {
  const months = data.overview.months;
  const settled = months.filter((m) => m < data.currentMonth);
  const lines = [
    "## 이 파일을 읽는 법",
    "",
    `- 오늘은 ${data.generatedAt}이고, 장부가 있는 달은 ${data.currentMonth}입니다.`,
  ];

  if (settled.length > 0) {
    lines.push(
      `- **${settled[0]} ~ ${settled[settled.length - 1]}는 실적입니다** — 장부에 기록된, 실제로 오간 돈입니다.`,
    );
  } else {
    lines.push("- 올해는 아직 끝난 달이 없어 실적이 없습니다.");
  }

  const ahead = months.filter((m) => m > data.currentMonth);
  if (ahead.length > 0) {
    lines.push(
      `- **${ahead[0]} ~ ${ahead[ahead.length - 1]}는 예산입니다** — 계획일 뿐, 쓴 돈이 아닙니다. 이 숫자를 실적처럼 말하지 마세요.`,
    );
  }

  lines.push(
    `- **${data.currentMonth}은 진행 중입니다.** 기본적으로 예산을 적었고, 이미 예산을 넘긴 항목만 실적을 적은 뒤 \`*\`를 붙였습니다.`,
    "- 빈 칸은 0이 아니라 「아무것도 말할 수 없음」입니다 — 장부가 시작되기 전이거나, 예산이 없는 달입니다.",
    "- 거래 내역은 최근 몇 달치뿐입니다. 그 앞은 월별 합계로만 있습니다.",
    "",
  );
  return lines;
}

function overviewSection(data: AnalysisExport): string[] {
  const { overview, money } = data;
  if (overview.sections.length === 0) return [];

  const heads = [
    "항목",
    ...overview.months.map((m) => `${Number(m.slice(5))}월`),
    "합계",
    "연예산",
  ];
  const lines = [`## 연간 개요 ${data.year}`, ""];

  for (const group of overview.sections) {
    lines.push(`### ${data.groupLabel(group.group)}`, "", `| ${heads.join(" | ")} |`);
    lines.push(`|${heads.map(() => "---").join("|")}|`);

    const cells = (line: { cells: YearOverview["saving"]["cells"] }) =>
      line.cells.map((cell) => {
        if (cell.blank) return "";
        // The month in progress only gets a mark where it has outrun its
        // plan — everywhere else the boundary above already said which
        // side of 지금 the column is on.
        const overran = cell.month === data.currentMonth && cell.source === "actual";
        return `${money(cell.amount)}${overran ? "*" : ""}`;
      });

    for (const band of group.bands) {
      for (const row of band.rows) {
        lines.push(
          `| ${[
            band.category ? `${row.name} (${band.category})` : row.name,
            ...cells(row),
            money(row.total),
            row.plan === 0 ? "" : money(row.plan),
          ].join(" | ")} |`,
        );
      }
    }
    lines.push(
      `| **${data.groupLabel(group.group)} 합계** | ${[
        ...cells(group),
        money(group.total),
        money(group.plan),
      ].join(" | ")} |`,
    );

    const yearly = yearAchievements(group);
    lines.push(
      `| 월 계획 대비 | ${group.cells
        .map((c) => {
          const rate = monthAchievement(c);
          return rate === null ? "" : percent(rate);
        })
        .join(" | ")} |  |  |`,
      `| 연 계획 대비 (누적) | ${yearly
        .map((p) => (p.rate === null ? "" : percent(p.rate)))
        .join(" | ")} |  |  |`,
      "",
    );
  }

  lines.push(
    "### 저축가능액 (수입 − 지출)",
    "",
    `| 항목 | ${overview.months.map((m) => `${Number(m.slice(5))}월`).join(" | ")} | 합계 | 연계획 |`,
    `|${Array.from({ length: overview.months.length + 3 }, () => "---").join("|")}|`,
    `| 저축가능액 | ${overview.saving.cells
      .map((c) => (c.blank ? "" : money(c.amount)))
      .join(" | ")} | ${money(overview.saving.total)} | ${money(overview.saving.plan)} |`,
    `| 누적 | ${overview.cumulativeSaving.map((a) => money(a)).join(" | ")} |  |  |`,
    "",
    "달성률은 예산이 있는 달·항목만 셉니다. 예산이 없는 지출은 합계에는 있지만 달성률에는 없습니다.",
    "",
  );
  return lines;
}

/** The whole file. */
export function buildAnalysisExport(data: AnalysisExport): string {
  const out: string[] = [
    "# moneybook 분석용 내보내기",
    "",
    `생성 ${data.generatedAt} · 통화 ${data.currency} · 시간대 ${data.timezone}`,
    "",
    ...readingNote(data),
    ...overviewSection(data),
  ];

  if (data.accounts.length > 0) {
    out.push("## 계정", "");
    for (const account of data.accounts) {
      out.push(
        `- ${account.name} — ${data.groupLabel(account.group)}${account.category ? ` / ${account.category}` : ""}`,
      );
    }
    out.push("");
  }

  if (data.balances.length > 0) {
    out.push(`## 자산·부채 (${data.generatedAt} 기준 잔액)`, "");
    for (const row of data.balances) {
      out.push(`- ${row.name} (${data.groupLabel(row.group)}) ${row.amount}`);
    }
    out.push("");
  }

  if (data.formulas.length > 0) {
    out.push("## 계산식", "", "장부가 직접 갖고 있지 않고, 사람이 정의해 둔 지표입니다.", "");
    for (const row of data.formulas) {
      out.push(`- ${row.name} = ${row.value}`);
    }
    out.push("");
  }

  if (data.budgetNotes.length > 0) {
    out.push("## 예산에 적어 둔 메모", "", "왜 그 금액으로 잡았는지 사람이 남긴 말입니다.", "");
    for (const note of data.budgetNotes) {
      out.push(`- ${note.periodKey} ${note.account} ${note.amount} — ${note.note}`);
    }
    out.push("");
  }

  out.push(
    `## 거래 내역 (${data.transactionsFrom} ~ ${data.transactionsTo})`,
    "",
    "전부가 아니라 최근 몇 달치입니다. 여기 없는 달은 위의 월별 합계로만 알 수 있습니다.",
    "",
  );
  if (data.transactions.length === 0) {
    out.push("(이 기간에 거래가 없습니다.)", "");
  } else {
    for (const tx of data.transactions) {
      out.push(
        `- ${tx.date} ${tx.flow} ${tx.amount} · ${tx.title.trim() || "(적요 없음)"}${
          tx.memo?.trim() ? ` — ${tx.memo.trim()}` : ""
        }`,
      );
    }
    out.push("");
  }

  return out.join("\n");
}
