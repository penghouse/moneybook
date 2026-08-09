import { describe, expect, it } from "vitest";
import {
  canTrackCounterparties,
  isActiveDuring,
  isActiveOn,
  isClosedBy,
  isFlowGroup,
  type ActiveWindow,
} from "./accounts";

const open: ActiveWindow = { activeFrom: null, activeTo: null };
const window = (activeFrom: string | null, activeTo: string | null): ActiveWindow => ({
  activeFrom,
  activeTo,
});

describe("isActiveOn", () => {
  it("treats an account with no window as always active", () => {
    expect(isActiveOn(open, "1999-01-01")).toBe(true);
    expect(isActiveOn(open, "2099-12-31")).toBe(true);
  });

  it("includes both ends of the interval", () => {
    const card = window("2024-03-01", "2024-03-31");
    expect(isActiveOn(card, "2024-03-01")).toBe(true);
    expect(isActiveOn(card, "2024-03-31")).toBe(true);
    expect(isActiveOn(card, "2024-02-29")).toBe(false);
    expect(isActiveOn(card, "2024-04-01")).toBe(false);
  });

  it("leaves the other end unbounded when only one is set", () => {
    expect(isActiveOn(window("2024-01-01", null), "2099-01-01")).toBe(true);
    expect(isActiveOn(window("2024-01-01", null), "2023-12-31")).toBe(false);
    expect(isActiveOn(window(null, "2024-01-01"), "1999-01-01")).toBe(true);
    expect(isActiveOn(window(null, "2024-01-01"), "2024-01-02")).toBe(false);
  });
});

describe("isActiveDuring", () => {
  // Overlap, not containment: a card closed on the 10th was still spent
  // from that month and belongs on that month's budget.
  it("is true when the window overlaps the period at all", () => {
    const closedMidMonth = window(null, "2024-03-10");
    expect(isActiveDuring(closedMidMonth, "2024-03-01", "2024-03-31")).toBe(true);
    const openedMidMonth = window("2024-03-20", null);
    expect(isActiveDuring(openedMidMonth, "2024-03-01", "2024-03-31")).toBe(true);
  });

  it("is true when the period sits entirely inside the window", () => {
    expect(isActiveDuring(window("2020-01-01", "2030-01-01"), "2024-03-01", "2024-03-31")).toBe(
      true,
    );
  });

  it("is false only when the two do not touch", () => {
    expect(isActiveDuring(window(null, "2024-02-29"), "2024-03-01", "2024-03-31")).toBe(false);
    expect(isActiveDuring(window("2024-04-01", null), "2024-03-01", "2024-03-31")).toBe(false);
  });

  it("counts a single-day window on the period's edge", () => {
    expect(isActiveDuring(window("2024-03-31", "2024-03-31"), "2024-03-01", "2024-03-31")).toBe(
      true,
    );
  });
});

describe("isClosedBy", () => {
  it("separates 'closed' from 'not open yet'", () => {
    // Both are inactive today, but only one is gone — the balance sheet
    // hides a spent-out closed account and keeps a scheduled one.
    const closed = window(null, "2024-03-31");
    const notYet = window("2099-01-01", null);
    expect(isActiveOn(closed, "2026-08-05")).toBe(false);
    expect(isActiveOn(notYet, "2026-08-05")).toBe(false);
    expect(isClosedBy(closed, "2026-08-05")).toBe(true);
    expect(isClosedBy(notYet, "2026-08-05")).toBe(false);
  });

  it("does not count the closing day itself as already closed", () => {
    expect(isClosedBy(window(null, "2024-03-31"), "2024-03-31")).toBe(false);
    expect(isClosedBy(window(null, "2024-03-31"), "2024-04-01")).toBe(true);
  });
});

describe("isFlowGroup", () => {
  it("splits the four groups into flows and levels", () => {
    expect(isFlowGroup("income")).toBe(true);
    expect(isFlowGroup("expense")).toBe(true);
    expect(isFlowGroup("asset")).toBe(false);
    expect(isFlowGroup("liability")).toBe(false);
  });

  // Two screens ask this question — the running-balance column and the
  // counterparty breakdown — and they must not answer it differently.
  it("is exactly the groups that cannot keep a counterparty breakdown", () => {
    for (const group of ["income", "expense", "asset", "liability"] as const) {
      expect(canTrackCounterparties(group)).toBe(!isFlowGroup(group));
    }
  });
});
