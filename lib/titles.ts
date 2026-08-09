/**
 * A 적요 with its parentheses taken off: 「점심 (회사 앞)」 → 「점심」.
 *
 * Used for the entry form's suggestions, and only there. What is stored
 * on a transaction is whatever was typed — the parenthetical is usually
 * the part that differs between two of the same thing (which branch,
 * whose birthday), so keeping it would fill the list with near-duplicates
 * and then paste one specific past occasion into a new entry.
 *
 * An unclosed bracket is treated as running to the end of the string,
 * since a half-typed 「점심 (회사」 means the same as the closed one.
 * Both half-width and full-width brackets, because a Korean keyboard
 * produces either.
 */
const BRACKETED = /[([{（［｛][^)\]}）］｝]*[)\]}）］｝]?/gu;

export function bareTitle(title: string): string {
  const stripped = title.replace(BRACKETED, " ").replace(/\s+/g, " ").trim();
  // A 적요 that is *only* a parenthetical still has to suggest something,
  // and the thing it typed is better than nothing.
  return stripped || title.trim();
}
