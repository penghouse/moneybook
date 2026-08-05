import type { Page } from "@playwright/test";

/**
 * A caption bar pinned over the page, shared by both walkthroughs.
 *
 * It lives outside <main>, and every assertion in the specs is scoped to
 * <main>, so caption wording can quote the UI without tripping
 * strict-mode locators.
 */
export async function caption(page: Page, text: string, holdMs = 1200) {
  await page.evaluate((label) => {
    // Sit above the phone's bottom tab bar rather than on top of it —
    // otherwise the recording hides the navigation it is narrating. The
    // bar is measured rather than assumed, so the desktop walkthrough
    // (which has no bottom bar) still pins the caption to the edge.
    const nav = document.querySelector<HTMLElement>("body > nav");
    const offset = nav && getComputedStyle(nav).position === "fixed" ? nav.offsetHeight : 0;

    let bar = document.getElementById("__demo_caption");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "__demo_caption";
      Object.assign(bar.style, {
        position: "fixed",
        insetInline: "0",
        // Bottom, not top: the app header is `sticky top-0` and the
        // mobile drawer is fixed at z-50, so a bar pinned to the top
        // would sit over the navigation for the whole recording.
        bottom: `${offset}px`,
        zIndex: "2147483647",
        padding: "10px 16px",
        background: "rgba(17,17,17,0.92)",
        color: "#fff",
        font: "600 15px/1.4 system-ui, sans-serif",
        pointerEvents: "none",
        textAlign: "center",
      } satisfies Partial<CSSStyleDeclaration>);
      document.body.appendChild(bar);
    }
    bar.textContent = label;
  }, text);
  await page.waitForTimeout(holdMs);
}

export async function goto(page: Page, path: string, label: string) {
  await page.goto(path);
  await caption(page, label);
}
