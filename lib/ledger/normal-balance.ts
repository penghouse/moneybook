import type { AccountGroup } from "@/db/schema";

const CREDIT_NORMAL_GROUPS: ReadonlySet<AccountGroup> = new Set(["liability", "equity", "income"]);

/**
 * Whether a right(credit) leg *raises* this group's own balance.
 *
 * Exported because the entry form needs the same rule to say which way a
 * leg moves the account it names, and two copies of the sign convention
 * is how they come to disagree. Kept in this leaf module rather than
 * behind the barrel so a client component can import it without pulling
 * the whole query layer into the browser bundle.
 */
export function isCreditNormal(group: AccountGroup): boolean {
  return CREDIT_NORMAL_GROUPS.has(group);
}

/**
 * Flips sign for credit-normal groups so a "healthy" balance is always
 * positive: money owed on a credit card, equity, and income all read as
 * positive numbers, even though they're right(credit)-heavy in raw
 * left-minus-right terms.
 */
export function normalBalance(group: AccountGroup, netLeftMinusRight: number): number {
  return CREDIT_NORMAL_GROUPS.has(group) ? -netLeftMinusRight : netLeftMinusRight;
}
