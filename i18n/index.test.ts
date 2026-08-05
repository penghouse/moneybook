import { describe, expect, it } from "vitest";
import ko from "./ko";
import en from "./en";

describe("i18n dictionaries", () => {
  it("ko and en expose the exact same keys", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ko).sort());
  });

  it("no translation value is empty", () => {
    for (const [key, value] of Object.entries({ ...ko, ...en })) {
      expect(value, `empty translation for "${key}"`).not.toBe("");
    }
  });
});
