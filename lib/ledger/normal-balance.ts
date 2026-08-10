import type { AccountGroup } from "@/db/schema";

const CREDIT_NORMAL_GROUPS: ReadonlySet<AccountGroup> = new Set(["liability", "equity", "income"]);

/**
 * Flips sign for credit-normal groups so a "healthy" balance is always
 * positive: money owed on a credit card, equity, and income all read as
 * positive numbers, even though they're right(credit)-heavy in raw
 * left-minus-right terms.
 */
export function normalBalance(group: AccountGroup, netLeftMinusRight: number): number {
  return CREDIT_NORMAL_GROUPS.has(group) ? -netLeftMinusRight : netLeftMinusRight;
}
