import { describe, expect, it } from "vitest";
import { parseHidden, serializeHidden } from "./quick-prefs";

describe("hidden quick entries", () => {
  it("comes back as it went in, for the month it was stamped with", () => {
    const raw = serializeHidden("2026-08", ["헬스장", "월세"]);
    expect(parseHidden(raw, "2026-08")).toEqual(["헬스장", "월세"]);
  });

  it("expires with the month — 「이번 달엔 안 쓸 것 같다」 is not a standing order", () => {
    const raw = serializeHidden("2026-08", ["헬스장"]);
    expect(parseHidden(raw, "2026-09")).toEqual([]);
  });

  it("survives a 적요 with a comma or a quote in it", () => {
    const titles = ["생활비, 고정", '"커피"'];
    expect(parseHidden(serializeHidden("2026-08", titles), "2026-08")).toEqual(titles);
  });

  it("drops duplicates", () => {
    const raw = serializeHidden("2026-08", ["점심", "점심", "커피"]);
    expect(parseHidden(raw, "2026-08")).toEqual(["점심", "커피"]);
  });

  it("has nothing to say about a missing, malformed or hostile cookie", () => {
    for (const raw of [
      undefined,
      "",
      "not json",
      "%E0%A4%A",
      encodeURIComponent(JSON.stringify(["점심"])),
      encodeURIComponent(JSON.stringify({ month: "2026-08" })),
      encodeURIComponent(JSON.stringify({ month: "2026-08", titles: "점심" })),
      encodeURIComponent(JSON.stringify(null)),
    ]) {
      expect(parseHidden(raw, "2026-08")).toEqual([]);
    }
  });

  it("keeps only strings out of a mixed list", () => {
    const raw = encodeURIComponent(
      JSON.stringify({ month: "2026-08", titles: ["점심", 3, null, "커피"] }),
    );
    expect(parseHidden(raw, "2026-08")).toEqual(["점심", "커피"]);
  });

  it("caps how much it will carry", () => {
    const many = Array.from({ length: 100 }, (_, i) => `항목${i}`);
    expect(parseHidden(serializeHidden("2026-08", many), "2026-08")).toHaveLength(32);
  });
});
