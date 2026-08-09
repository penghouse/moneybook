import { describe, expect, it } from "vitest";
import { collectTags, hasTag, normalizeTag, parseTags } from "./tags";

describe("parseTags", () => {
  it("reads tags out of ordinary memo text", () => {
    expect(parseTags("커피 #낭비 마셨음")).toEqual(["낭비"]);
    expect(parseTags("#낭비 #선물")).toEqual(["낭비", "선물"]);
  });

  it("ends a tag at whitespace and at punctuation", () => {
    expect(parseTags("#낭비, 그리고 #선물.")).toEqual(["낭비", "선물"]);
    expect(parseTags("#a-b")).toEqual(["a"]);
  });

  // The whole reason the match is a token and not a substring.
  it("keeps 낭비 and 낭비벽 apart", () => {
    expect(parseTags("#낭비벽")).toEqual(["낭비벽"]);
    expect(hasTag(["#낭비벽"], "낭비")).toBe(false);
    expect(hasTag(["#낭비"], "낭비")).toBe(true);
  });

  it("folds ASCII case so #Food and #food are one tag", () => {
    expect(parseTags("#Food #FOOD #food")).toEqual(["food"]);
  });

  it("ignores a bare # and text with no tag", () => {
    expect(parseTags("# 낭비")).toEqual([]);
    expect(parseTags("그냥 메모")).toEqual([]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags("")).toEqual([]);
  });

  it("does not repeat a tag written twice", () => {
    expect(parseTags("#낭비 하고 또 #낭비")).toEqual(["낭비"]);
  });
});

describe("collectTags", () => {
  it("merges a transaction's memo with its lines', without duplicates", () => {
    expect(collectTags(["점심 #낭비", null, "#낭비 #현금", undefined])).toEqual(["낭비", "현금"]);
  });
});

describe("hasTag", () => {
  it("matches across any of the memos", () => {
    expect(hasTag([null, "세부 #선물"], "선물")).toBe(true);
    expect(hasTag(["점심 #낭비"], "선물")).toBe(false);
  });

  it("accepts the tag with or without its #", () => {
    expect(hasTag(["#낭비"], "#낭비")).toBe(true);
  });

  it("is false for something that is not a tag", () => {
    expect(hasTag(["#낭비"], "  ")).toBe(false);
    expect(hasTag(["#낭비"], "낭 비")).toBe(false);
  });
});

describe("normalizeTag", () => {
  it("strips a leading # and lower-cases", () => {
    expect(normalizeTag("#Food")).toBe("food");
    expect(normalizeTag(" 낭비 ")).toBe("낭비");
  });

  it("rejects anything that is not a single tag token", () => {
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag("#")).toBeNull();
    expect(normalizeTag("두 개")).toBeNull();
    expect(normalizeTag("#a#b")).toBeNull();
    expect(normalizeTag(null)).toBeNull();
  });
});
