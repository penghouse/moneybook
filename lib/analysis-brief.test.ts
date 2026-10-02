import { describe, expect, it } from "vitest";
import { BRIEF_LIMIT, briefLineCount, renderBrief } from "./analysis-brief";

describe("renderBrief", () => {
  it("lays the screen out as the text that gets sent", () => {
    expect(
      renderBrief({
        heading: "예산 · 2026-08 · KRW",
        lines: [
          { label: "지출 예산", plan: "₩858,000", actual: "₩980,000" },
          {
            label: "교통비",
            depth: 1,
            plan: "₩88,000",
            actual: "₩205,000",
            note: "KTX 왕복 출장, 택시비",
          },
        ],
        footnotes: ["지난 달까지는 실적입니다."],
      }),
    ).toBe(
      [
        "예산 · 2026-08 · KRW",
        "지출 예산 계획 ₩858,000 / 실적 ₩980,000",
        "  교통비 계획 ₩88,000 / 실적 ₩205,000",
        "    ↳ KTX 왕복 출장, 택시비",
        "지난 달까지는 실적입니다.",
      ].join("\n"),
    );
  });

  it("calls the two figures what the screen calls them", () => {
    // A comparison's first column is the previous period, not a plan.
    // Naming it 「계획」 would hand the model a premise the book never
    // made — and it would answer confidently from it.
    const text = renderBrief({
      heading: "기간 비교 · KRW",
      pair: ["이전(2026-08-01~2026-08-31)", "현재(2026-09-01~2026-09-30)"],
      lines: [{ label: "식비", plan: "₩620,000", actual: "₩744,000" }],
    });

    expect(text).toContain("식비 이전(2026-08-01~2026-08-31) ₩620,000");
    expect(text).toContain("현재(2026-09-01~2026-09-30) ₩744,000");
    expect(text).not.toContain("계획");
  });

  it("says one figure on its own without inventing the other", () => {
    const text = renderBrief({
      heading: "예산 · 2026-08",
      lines: [{ label: "잡비", depth: 1, plan: null, actual: "₩12,000" }],
    });
    expect(text).toContain("  잡비 실적 ₩12,000");
  });

  it("cuts a brief that would run away, and says it cut it", () => {
    // A book with hundreds of accounts should still get an answer about
    // the first hundred; an unannounced cut would read as the end.
    const long = renderBrief({
      heading: "예산",
      lines: Array.from({ length: 2_000 }, (_, i) => ({
        label: `계정${i}`,
        actual: "₩1,000,000",
      })),
    });

    expect(long.length).toBeLessThan(BRIEF_LIMIT + 60);
    expect(long).toContain("잘렸습니다");
  });

  it("counts the lines the reader is told they are sending", () => {
    expect(
      briefLineCount({
        heading: "예산",
        lines: [
          { label: "식비", actual: "₩1" },
          { label: "교통비", actual: "₩2", note: "택시" },
        ],
      }),
    ).toBe(4);
  });
});
