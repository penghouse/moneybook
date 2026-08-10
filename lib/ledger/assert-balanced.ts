import type { LineSide, TransactionKind } from "@/db/schema";
import { convertMinorUnits } from "../money";

export class UnbalancedTransactionError extends Error {}

export interface BalanceLineInput {
  side: LineSide;
  currency: string;
  amount: number;
  rate: number | null;
  baseAmount: number;
}

/**
 * The one gate every save path (server actions, CSV import, the
 * "환율 반영" revaluation flow) must pass before a transaction's lines
 * are written. Throws on the first violation rather than collecting all
 * of them — this app's transactions are small enough that "fix one, try
 * again" is fine.
 *
 * A `kind: 'revaluation'` transaction is special: the leg denominated in
 * a foreign (non-base) currency moves baseAmount without moving its own
 * currency's amount (the point of a revaluation is that the dollar
 * balance didn't change, only its won valuation did), so that leg is
 * exempt from the amount*rate=baseAmount check and must have amount=0,
 * rate=null instead. The offsetting P&L leg (외화환산이익/손실), which is
 * denominated in the base currency itself, is not exempt and is
 * validated normally.
 */
export function assertBalanced(
  lines: readonly BalanceLineInput[],
  baseCurrency: string,
  kind: TransactionKind = "normal",
): void {
  if (lines.length < 2) {
    throw new UnbalancedTransactionError("a transaction needs at least two lines");
  }
  if (!lines.some((l) => l.side === "left") || !lines.some((l) => l.side === "right")) {
    throw new UnbalancedTransactionError(
      "a transaction needs at least one left line and one right line",
    );
  }

  let left = 0;
  let right = 0;

  for (const line of lines) {
    if (line.amount < 0 || line.baseAmount < 0) {
      throw new UnbalancedTransactionError(
        "amount and baseAmount must not be negative; direction comes from `side`",
      );
    }

    const isRevaluationLeg = kind === "revaluation" && line.currency !== baseCurrency;

    if (isRevaluationLeg) {
      if (line.rate !== null || line.amount !== 0) {
        throw new UnbalancedTransactionError(
          "a revaluation line in a foreign currency must have amount=0 and rate=null",
        );
      }
    } else {
      if (line.rate === null || line.rate <= 0) {
        throw new UnbalancedTransactionError("a non-revaluation line needs a positive rate");
      }
      const expected = convertMinorUnits(line.amount, line.rate, line.currency, baseCurrency);
      if (expected !== line.baseAmount) {
        throw new UnbalancedTransactionError(
          `baseAmount (${line.baseAmount}) does not match amount*rate (expected ${expected})`,
        );
      }
    }

    if (line.side === "left") left += line.baseAmount;
    else right += line.baseAmount;
  }

  if (left !== right) {
    throw new UnbalancedTransactionError(`left (${left}) and right (${right}) do not balance`);
  }
}
