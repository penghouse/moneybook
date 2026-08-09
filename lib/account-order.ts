/**
 * How a group's accounts are arranged: category blocks in order, and
 * accounts in order within each block.
 *
 * `sort_order` is a single number per account, group-wide, but the
 * screen reads it as two levels — 「먹는 것」 above 「타는 것」, 식비 above
 * 카페 inside 「먹는 것」. Nothing kept those two views in agreement, so
 * 위로 swapped an account with whichever account happened to hold the
 * adjacent number, which could be one from a different category. The
 * two rows then traded numbers and rendered in exactly the same place:
 * the button appeared to do nothing at all.
 *
 * The fix is to make the stored order *be* the read order. Every move
 * rebuilds the whole group's sequence with its categories contiguous
 * and renumbers 0..n-1, so an account can only ever move within its own
 * block and a block moves whole. There is no separate category-order
 * column: once blocks are contiguous, their order is just the order
 * their first account appears in.
 *
 * 미분류 is pinned last and cannot be moved. It is the absence of a
 * category rather than one of them, and letting it float would make
 * "below everything" a position you could lose by accident.
 */

export interface OrderableAccount {
  id: string;
  category: string | null;
  sortOrder: number;
}

export interface CategoryBlock<T extends OrderableAccount> {
  category: string | null;
  accounts: T[];
}

export type MoveDirection = "up" | "down";

/**
 * Accounts as blocks, in the order the screen shows them: by current
 * `sortOrder`, categories keyed on first appearance, 미분류 last.
 * `accounts` is assumed already sorted by sortOrder.
 */
export function categoryBlocks<T extends OrderableAccount>(
  accounts: readonly T[],
): CategoryBlock<T>[] {
  const byCategory = new Map<string | null, T[]>();
  for (const account of accounts) {
    const key = account.category ?? null;
    const bucket = byCategory.get(key);
    if (bucket) bucket.push(account);
    else byCategory.set(key, [account]);
  }
  return [...byCategory.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : 0))
    .map(([category, accounts]) => ({ category, accounts }));
}

function flatten<T extends OrderableAccount>(blocks: readonly CategoryBlock<T>[]): T[] {
  return blocks.flatMap((b) => b.accounts);
}

/** Swaps `list[i]` with its neighbour, or returns null at the end it cannot move past. */
function swapped<T>(list: readonly T[], index: number, direction: MoveDirection): T[] | null {
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= list.length) return null;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * The group's new full order after moving one account within its own
 * category, or null when it is already at that end of its block.
 */
export function moveAccountWithinCategory<T extends OrderableAccount>(
  accounts: readonly T[],
  accountId: string,
  direction: MoveDirection,
): T[] | null {
  const blocks = categoryBlocks(accounts);
  const blockIndex = blocks.findIndex((b) => b.accounts.some((a) => a.id === accountId));
  if (blockIndex === -1) return null;

  const block = blocks[blockIndex];
  const reordered = swapped(
    block.accounts,
    block.accounts.findIndex((a) => a.id === accountId),
    direction,
  );
  if (reordered === null) return null;

  const next = [...blocks];
  next[blockIndex] = { ...block, accounts: reordered };
  return flatten(next);
}

/**
 * The group's new full order after moving a whole category block, or
 * null when it cannot move — already at that end, or 미분류, which does
 * not take part.
 */
export function moveCategoryBlock<T extends OrderableAccount>(
  accounts: readonly T[],
  category: string,
  direction: MoveDirection,
): T[] | null {
  const blocks = categoryBlocks(accounts);
  // Only the named blocks reorder; 미분류 keeps the end.
  const named = blocks.filter((b) => b.category !== null);
  const rest = blocks.filter((b) => b.category === null);

  const reordered = swapped(
    named,
    named.findIndex((b) => b.category === category),
    direction,
  );
  if (reordered === null) return null;
  return flatten([...reordered, ...rest]);
}

/** Which accounts actually changed number, so a move writes as few rows as it must. */
export function renumber<T extends OrderableAccount>(
  order: readonly T[],
): { id: string; sortOrder: number }[] {
  return order
    .map((account, index) => ({ id: account.id, sortOrder: index }))
    .filter(({ id, sortOrder }) => order.find((a) => a.id === id)!.sortOrder !== sortOrder);
}
