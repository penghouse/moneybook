import { describe, expect, it } from "vitest";
import { bareTitle } from "./titles";

describe("bareTitle", () => {
  it("drops a trailing parenthetical", () => {
    expect(bareTitle("점심 (회사 앞)")).toBe("점심");
    expect(bareTitle("점심(회사 앞)")).toBe("점심");
  });

  it("drops one in the middle, without gluing the words together", () => {
    expect(bareTitle("생일 (형) 선물")).toBe("생일 선물");
  });

  it("handles more than one", () => {
    expect(bareTitle("커피 (스벅) (아메)")).toBe("커피");
  });

  it("treats an unclosed bracket as running to the end", () => {
    expect(bareTitle("점심 (회사")).toBe("점심");
  });

  it("takes full-width and square brackets too", () => {
    expect(bareTitle("점심 （회사 앞）")).toBe("점심");
    expect(bareTitle("점심 [회사 앞]")).toBe("점심");
  });

  it("leaves a title with no brackets alone", () => {
    expect(bareTitle("점심")).toBe("점심");
    expect(bareTitle("  점심  ")).toBe("점심");
  });

  // Stripping everything would leave no suggestion at all, which is
  // worse than suggesting the odd thing that was typed.
  it("falls back to the original when the whole title is bracketed", () => {
    expect(bareTitle("(현금)")).toBe("(현금)");
  });
});
