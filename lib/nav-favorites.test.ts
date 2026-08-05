import { describe, expect, it } from "vitest";
import { NAV_HREFS } from "@/app/_components/nav-items";
import {
  DEFAULT_FAVORITES,
  MAX_FAVORITES,
  parseFavorites,
  serializeFavorites,
} from "./nav-favorites";

describe("parseFavorites", () => {
  it("keeps the given order", () => {
    expect(parseFavorites("/budget,/")).toEqual(["/budget", "/"]);
  });

  it("drops hrefs that are not routes", () => {
    // The whole point of parsing rather than trusting: retiring a page
    // must not leave a tab that navigates nowhere.
    expect(parseFavorites("/,/gone,/assets")).toEqual(["/", "/assets"]);
  });

  it("drops duplicates", () => {
    expect(parseFavorites("/,/,/assets")).toEqual(["/", "/assets"]);
  });

  it("caps at MAX_FAVORITES", () => {
    const all = NAV_HREFS.join(",");
    expect(NAV_HREFS.length).toBeGreaterThan(MAX_FAVORITES);
    expect(parseFavorites(all)).toEqual(NAV_HREFS.slice(0, MAX_FAVORITES));
  });

  it("falls back to the defaults rather than emptying the bar", () => {
    // An empty bar would leave "더보기" as the only way to go anywhere.
    expect(parseFavorites("")).toEqual([...DEFAULT_FAVORITES]);
    expect(parseFavorites(null)).toEqual([...DEFAULT_FAVORITES]);
    expect(parseFavorites("/nope,/also-nope")).toEqual([...DEFAULT_FAVORITES]);
  });

  it("tolerates whitespace around entries", () => {
    expect(parseFavorites(" / , /assets ")).toEqual(["/", "/assets"]);
  });

  it("every default is a real route", () => {
    for (const href of DEFAULT_FAVORITES) expect(NAV_HREFS).toContain(href);
  });
});

describe("serializeFavorites", () => {
  it("round-trips through parseFavorites", () => {
    expect(serializeFavorites(["/budget", "/"])).toBe("/budget,/");
    expect(parseFavorites(serializeFavorites(["/budget", "/"]))).toEqual(["/budget", "/"]);
  });

  it("sanitizes on the way in, so a bad write cannot be stored", () => {
    expect(serializeFavorites(["/gone", "/assets", "/assets"])).toBe("/assets");
    expect(serializeFavorites([])).toBe(DEFAULT_FAVORITES.join(","));
  });
});
