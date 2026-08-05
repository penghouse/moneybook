import { describe, expect, it } from "vitest";
import { isAllChoseong, matchesQuery, toChoseongString } from "./hangul";

describe("toChoseongString", () => {
  it("extracts initial consonants from Korean syllables", () => {
    expect(toChoseongString("식비")).toBe("ㅅㅂ");
    expect(toChoseongString("국민은행")).toBe("ㄱㅁㅇㅎ");
  });

  it("leaves non-Korean characters untouched", () => {
    expect(toChoseongString("Cash 123")).toBe("Cash 123");
  });
});

describe("isAllChoseong", () => {
  it("is true only for a non-empty string of pure initial consonants", () => {
    expect(isAllChoseong("ㅅㅂ")).toBe(true);
    expect(isAllChoseong("식비")).toBe(false);
    expect(isAllChoseong("")).toBe(false);
  });
});

describe("matchesQuery", () => {
  it("matches by choseong", () => {
    expect(matchesQuery("식비", "ㅅㅂ")).toBe(true);
    expect(matchesQuery("국민은행", "ㄱㅁ")).toBe(true);
    expect(matchesQuery("식비", "ㅍㅁ")).toBe(false);
  });

  it("matches by plain substring", () => {
    expect(matchesQuery("식비", "식")).toBe(true);
    expect(matchesQuery("식비", "비")).toBe(true);
    expect(matchesQuery("Cash", "ca")).toBe(true);
  });

  it("an empty query matches everything", () => {
    expect(matchesQuery("식비", "")).toBe(true);
  });

  it("does not choseong-match a query that mixes initials with other characters", () => {
    expect(matchesQuery("식비", "ㅅ빔")).toBe(false);
  });
});
