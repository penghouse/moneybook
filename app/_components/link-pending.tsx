"use client";

import { useLinkStatus } from "next/link";

/**
 * A spinner on the link that was pressed, for the moment before the next
 * screen arrives.
 *
 * `loading.tsx` covers a change of route. It does not cover these: the
 * period bar moves 이전 달 / 다음 달 by changing the query string on the
 * *same* route, so no segment changes, no boundary re-suspends, and the
 * screen simply sits there — for as long as the database takes — with
 * nothing to say a press registered. On a phone that reads as a tap that
 * missed.
 *
 * Must be a descendant of the `<Link>` it reports on, which is why it is
 * its own component rather than a prop on the bar.
 *
 * Fixed size, always rendered, opacity toggled: an indicator that
 * appears out of nothing reflows the row it sits in, and the row it sits
 * in is a pair of arrows being tapped with a thumb.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();

  return (
    <span
      aria-hidden="true"
      data-pending={pending ? "true" : undefined}
      data-testid="link-pending"
      className={`border-rule border-t-accent inline-block size-3 shrink-0 rounded-full border-2 transition-opacity ${
        pending ? "animate-spin opacity-100" : "opacity-0"
      }`}
    />
  );
}
