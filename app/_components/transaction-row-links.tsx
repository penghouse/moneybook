import Link from "next/link";
import { monthRange, yearMonthOf } from "@/lib/date";
import { splitMemo } from "@/lib/tags";

interface RowAccount {
  id: string;
  name: string;
}

/**
 * The account names on one side of a row, each opening its own month.
 *
 * Every one of them is a link rather than "식비 외 1": on a split, the
 * account you want to look at is as likely to be the second as the
 * first, and a count cannot be pressed.
 */
function AccountLinks({
  accounts,
  range,
}: {
  accounts: readonly RowAccount[];
  range: { from: string; to: string };
}) {
  return (
    <>
      {accounts.map((account, i) => (
        <span key={account.id} className="min-w-0">
          {i > 0 && <span className="text-ink-faint">, </span>}
          <Link
            href={`/?accountId=${account.id}&from=${range.from}&to=${range.to}`}
            className="hover:text-ink underline decoration-transparent underline-offset-2 hover:decoration-current"
          >
            {account.name}
          </Link>
        </span>
      ))}
    </>
  );
}

/**
 * The strip under a transaction row: which accounts it touched, and
 * whatever was written on it.
 *
 * Sits outside the row's own button on purpose — these are links, and a
 * link inside a button is neither. The row's top line still opens the
 * editor; this strip is the part that goes somewhere else.
 */
export function TransactionRowLinks({
  date,
  memo,
  left,
  right,
  period,
  tagHref,
}: {
  date: string;
  /** Already joined by the caller, transaction memo first. */
  memo: string;
  left: readonly { account: RowAccount }[];
  right: readonly { account: RowAccount }[];
  /** The period the list is reading, if it is filtered to one. */
  period?: { from: string; to: string };
  tagHref: (tag: string) => string;
}) {
  // One link per *account*, not per line: a transaction may put two
  // lines on the same account — 식비 12,000 and 식비 8,000 in one split
  // — and naming it twice says there were two accounts.
  const dedupe = (lines: readonly { account: RowAccount }[]) => [
    ...new Map(lines.map((l) => [l.account.id, l.account])).values(),
  ];
  // Falls back to the month the transaction is in: an unfiltered list has
  // no period of its own to inherit.
  const range = period ?? monthRange(yearMonthOf(date));

  return (
    <div className="-mt-1.5 px-4 pb-2.5">
      <div className="text-ink-muted flex flex-wrap items-center gap-x-1.5 text-sm">
        <AccountLinks accounts={dedupe(left)} range={range} />
        <span className="text-ink-faint shrink-0">←</span>
        <AccountLinks accounts={dedupe(right)} range={range} />
      </div>
      {/* The memo was written on this transaction and then only ever
          visible by opening it. A row that hides what you typed is a row
          you have to open to trust — and a tag in it is a filter, so it
          reads as one rather than as grey text. */}
      {memo && (
        <div className="text-ink-faint mt-0.5 flex flex-wrap items-center gap-x-1 text-xs">
          {splitMemo(memo).map((segment, i) =>
            segment.kind === "text" ? (
              <span key={i} className="min-w-0 break-keep">
                {segment.value.trim()}
              </span>
            ) : (
              <Link
                key={i}
                href={tagHref(segment.value)}
                className="bg-sunken text-ink-muted hover:bg-rule rounded-full px-2 py-0.5"
              >
                {segment.raw}
              </Link>
            ),
          )}
        </div>
      )}
    </div>
  );
}
