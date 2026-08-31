export interface Slice {
  id: string;
  name: string;
  amount: number;
}

/** How many named rows a composition shows before the rest become 기타. */
export const COMPOSITION_LIMIT = 6;

/**
 * The big slices by name, and everything else as one.
 *
 * A composition is answering "what is most of this", and the tail is the
 * part that cannot answer it: forty 적요 at half a percent each is four
 * hundred pixels of rows nobody reads, pushing the list they came for
 * off the screen. The card should be about as tall whatever the month
 * happened to contain.
 *
 * The tail is summed rather than dropped, so the bars still add to the
 * whole and the figure at the top of the card is still the figure the
 * rows make. What is lost is the *names* of the small ones — and they
 * are one tap away in the list underneath, which is the thing this card
 * sits above.
 */
export function foldComposition(
  slices: readonly Slice[],
  restId: string,
  restName: (count: number) => string,
  limit = COMPOSITION_LIMIT,
): Slice[] {
  const sorted = [...slices].sort((a, b) => b.amount - a.amount);
  // Folding one row into a 기타 row buys nothing — same height, less
  // said — so the fold starts only once it actually shortens the card.
  if (sorted.length <= limit + 1) return sorted;

  const kept = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  return [
    ...kept,
    {
      id: restId,
      name: restName(rest.length),
      amount: rest.reduce((sum, slice) => sum + slice.amount, 0),
    },
  ];
}
