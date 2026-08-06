import { ACCOUNT_GROUPS, type AccountGroup } from "@/db/schema";

/**
 * The order the five account groups are listed in.
 *
 * `ACCOUNT_GROUPS` is two things at once everywhere it is used: the set
 * of groups that exist (which validation needs, and which no user may
 * change) and the order they appear in (which is presentation, and which
 * every book will want differently). This splits the second off. Import
 * validation and the `group` CHECK keep using the constant; screens use
 * what comes back from here.
 *
 * Stored on the section as a comma-separated list, the same way
 * `navFavorites` is, so it follows the book rather than the browser.
 *
 * Parsed rather than trusted: a stored value that is missing a group,
 * repeats one, or names something that is not a group still yields all
 * five, once each. That matters more than it looks — a group dropped
 * from this list would vanish from the accounts page along with every
 * account filed under it, which reads as data loss rather than as a
 * display setting gone wrong.
 */
export const DEFAULT_GROUP_ORDER: readonly AccountGroup[] = ACCOUNT_GROUPS;

export function parseGroupOrder(stored: string | null | undefined): AccountGroup[] {
  const seen = new Set<AccountGroup>();
  const kept: AccountGroup[] = [];

  for (const raw of (stored ?? "").split(",")) {
    const group = raw.trim() as AccountGroup;
    if (!ACCOUNT_GROUPS.includes(group) || seen.has(group)) continue;
    seen.add(group);
    kept.push(group);
  }

  // Anything the stored value failed to mention goes on the end, in the
  // canonical order, so the result is always a permutation of all five.
  for (const group of ACCOUNT_GROUPS) {
    if (!seen.has(group)) kept.push(group);
  }

  return kept;
}

export function serializeGroupOrder(groups: readonly AccountGroup[]): string {
  return parseGroupOrder(groups.join(",")).join(",");
}

/** The list with `group` moved one place towards the front or the back. */
export function moveGroup(
  order: readonly AccountGroup[],
  group: AccountGroup,
  direction: "up" | "down",
): AccountGroup[] {
  const next = [...order];
  const index = next.indexOf(group);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * A comparator for anything carrying a group, so a list of balances or
 * flows can be put in the book's own order.
 */
export function byGroupOrder(order: readonly AccountGroup[]) {
  const rank = new Map(order.map((group, i) => [group, i]));
  return (a: AccountGroup, b: AccountGroup) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0);
}
