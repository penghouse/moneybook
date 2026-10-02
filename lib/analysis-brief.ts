/**
 * What gets sent, and nothing else.
 *
 * The screen already holds every figure the question needs, so the brief
 * is built from what is on it rather than from a fresh pass over the
 * ledger. That keeps two promises at once: the analysis cannot disagree
 * with the screen it was asked from, and the reader can be shown the
 * exact text that left the device — which is the only honest way to ask
 * someone to send their household accounts anywhere.
 *
 * Deliberately not the transactions. A month of entries is both far more
 * than the question needs and far more than anyone would want to hand
 * over; the per-account totals and whatever was written on them say the
 * same thing in thirteen lines.
 */

/** One figure's worth of context, already formatted by the caller. */
export interface BriefLine {
  label: string;
  /** Indent level — 0 is a heading row, 1 an item under it. */
  depth?: 0 | 1;
  /** The pair of figures, named by the brief's own `pair`. */
  plan?: string | null;
  actual?: string | null;
  /** Free text under the line: a budget note, the month's memos. */
  note?: string | null;
}

export interface Brief {
  /** '예산 · 2026-08' — what the reader is looking at. */
  heading: string;
  /**
   * What the two figures on a line are called.
   *
   * 계획/실적 on the budget and the year, 이전/현재 on a comparison. The
   * same pair of numbers means different things on different screens,
   * and a brief that called a previous period 「계획」 would be handing
   * the model a false premise to reason from.
   */
  pair?: readonly [string, string];
  /** One line each, in the order the screen shows them. */
  lines: readonly BriefLine[];
  /** Anything the screen knows that the lines do not carry. */
  footnotes?: readonly string[];
}

/** The longest brief the screen will send, in characters. */
export const BRIEF_LIMIT = 8_000;

/** The longest follow-up question, in characters. */
export const QUESTION_LIMIT = 500;

/**
 * The brief as the plain text that is both shown to the reader and sent.
 *
 * One rendering, not two. A 「보낸 내용」 panel that re-formats the data
 * would be showing something adjacent to what was sent rather than the
 * thing itself, and the whole point of the panel is that it is the thing
 * itself.
 */
export function renderBrief(brief: Brief): string {
  const out: string[] = [brief.heading];
  const [first, second] = brief.pair ?? ["계획", "실적"];

  for (const line of brief.lines) {
    const indent = line.depth === 1 ? "  " : "";
    const figures =
      line.plan != null && line.actual != null
        ? ` ${first} ${line.plan} / ${second} ${line.actual}`
        : line.actual != null
          ? ` ${second} ${line.actual}`
          : line.plan != null
            ? ` ${first} ${line.plan}`
            : "";
    out.push(`${indent}${line.label}${figures}`);
    if (line.note) out.push(`${indent}  ↳ ${line.note}`);
  }

  for (const note of brief.footnotes ?? []) out.push(note);

  const text = out.join("\n");
  // Truncated rather than refused: a book with two hundred accounts
  // should still get an answer about its first hundred, and saying so in
  // the text is what stops the model from reading the cut as the end.
  return text.length <= BRIEF_LIMIT
    ? text
    : `${text.slice(0, BRIEF_LIMIT)}\n…(이 아래는 길어서 잘렸습니다)`;
}

/** How many lines the reader is told they are sending. */
export function briefLineCount(brief: Brief): number {
  return renderBrief(brief).split("\n").length;
}
