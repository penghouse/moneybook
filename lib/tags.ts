/**
 * Tags are written inside memos — `커피 #낭비` — rather than stored in a
 * column or a table of their own.
 *
 * The alternative is a `tags` table plus a join table, kept in step by
 * every write path there is: the entry form, the edit form, and three
 * CSV importers. That is five places to forget, in exchange for a
 * rename-in-one-place this book will not need. The same trade was
 * already made for an account's 상위 그룹, which is free text with a
 * datalist of what already exists.
 *
 * A tag is `#` followed by letters, digits or underscores — so it ends
 * at a space or at punctuation, and 「#낭비」 and 「#낭비벽」 are two
 * different tags rather than one matching the other. ASCII folds to
 * lower case so `#Food` and `#food` are one tag; Korean is unaffected.
 */

const TAG = /#([\p{L}\p{N}_]+)/gu;

/** Every tag in a piece of text, lower-cased, in first-seen order. */
export function parseTags(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  for (const [, tag] of text.matchAll(TAG)) seen.add(tag.toLowerCase());
  return [...seen];
}

/** Every tag across a transaction's memo and its lines' memos. */
export function collectTags(texts: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const text of texts) for (const tag of parseTags(text)) seen.add(tag);
  return [...seen];
}

/**
 * Whether any of these memos carries exactly this tag.
 *
 * Exactly, not as a substring: a `LIKE '%#낭비%'` in SQL narrows the
 * rows worth looking at but would also match 「#낭비벽」, so the decision
 * is made here where the token boundary is known.
 */
export function hasTag(texts: readonly (string | null | undefined)[], tag: string): boolean {
  const wanted = normalizeTag(tag);
  return wanted !== null && collectTags(texts).includes(wanted);
}

/**
 * A tag as it is stored and compared: no leading '#', lower-cased, and
 * null if what was typed is not a tag at all. Accepts both 「낭비」 and
 * 「#낭비」, since a URL and a text box will each see one of them.
 */
export function normalizeTag(input: string | null | undefined): string | null {
  if (!input) return null;
  const match = input
    .trim()
    .replace(/^#/, "")
    .match(/^[\p{L}\p{N}_]+$/u);
  return match ? match[0].toLowerCase() : null;
}
