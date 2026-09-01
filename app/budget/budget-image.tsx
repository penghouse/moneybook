"use client";

import { useState } from "react";
import { buttonClass } from "../_components/ui";

/** One account, already formatted — the canvas only ever draws strings. */
export interface BudgetImageRow {
  name: string;
  actual: string;
  /** Null where nothing was budgeted. */
  budget: string | null;
  /** 0–100, already clamped. */
  bar: number;
  percent: number | null;
  over: boolean;
}

export interface BudgetImageBand {
  /** Null where the book files nothing under 상위 그룹. */
  category: string | null;
  rows: BudgetImageRow[];
}

export interface BudgetImageSection {
  label: string;
  actual: string;
  budget: string | null;
  bar: number;
  percent: number | null;
  over: boolean;
  bands: BudgetImageBand[];
}

export interface BudgetImageLabels {
  save: string;
  saving: string;
  title: string;
  uncategorized: string;
  over: string;
}

/** Wide enough to read on a phone, which is where this gets looked at. */
const WIDTH = 1080;
/**
 * The height follows the content, with only enough of a floor to keep a
 * one-item month from coming out as a strip.
 *
 * Not a phone's aspect ratio: a fixed 1080×1920 left half the picture
 * blank for an ordinary month, and blank space is the thing this button
 * exists to remove.
 */
const MIN_HEIGHT = 480;
const PAD = 64;
const ROW_H = 78;
const BAND_H = 58;
const SECTION_GAP = 56;

/**
 * A light palette, fixed rather than read off the page.
 *
 * The image outlives the theme it was made under — it is sent to someone,
 * saved, looked at next month — so it should not come out dark because of
 * a setting that was true for a minute. These are the light theme's own
 * tokens, spelled out because canvas cannot read CSS variables.
 */
const INK = "#191f28";
const INK_MUTED = "#4e5968";
const INK_FAINT = "#8b95a1";
const PAPER = "#ffffff";
const BAND = "#f2f4f6";
const RULE = "#edf0f3";
const ACCENT = "#4338ca";
const NEGATIVE = "#c2372b";

const FAMILY =
  '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Pretendard, system-ui, "Malgun Gothic", sans-serif';
const font = (size: number, weight = 400) => `${weight} ${size}px ${FAMILY}`;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(w, 0), h, r);
  ctx.fill();
}

/**
 * Where the drawing ends, walked with the very steps the drawing takes.
 *
 * Two copies of this arithmetic is two chances to leave a band of blank
 * paper under the last row — which is the thing the picture is for
 * getting rid of.
 */
function layoutHeight(summaryLines: number, sections: readonly BudgetImageSection[]): number {
  let y = PAD + 56 + 40 + summaryLines * 56;
  for (const section of sections) {
    y += SECTION_GAP + 22 + 60;
    for (const band of section.bands) {
      if (band.category !== null) y += BAND_H;
      y += band.rows.length * ROW_H;
    }
  }
  // The footer's baseline, and room under it to match the margin above.
  return y + 50 + PAD;
}

/**
 * The month's budget as one picture.
 *
 * Settling a month meant screenshotting a page that is taller than any
 * phone — three or four captures, stitched or sent one after another,
 * with the totals in one and the items in another. Drawn from the data
 * instead, the whole month is one image at a width a phone can read.
 *
 * A canvas rather than a screenshot library: the alternative re-implements
 * CSS layout in JavaScript, which is a large dependency for one button
 * and gets fonts and overflow subtly wrong anyway.
 */
export function BudgetImage({
  period,
  summary,
  sections,
  labels,
}: {
  period: string;
  /** 저축 and 예산대로면, one per line under the month. */
  summary: readonly { label: string; value: string }[];
  sections: readonly BudgetImageSection[];
  labels: BudgetImageLabels;
}) {
  const [busy, setBusy] = useState(false);

  const draw = async () => {
    setBusy(true);
    try {
      const height = Math.max(MIN_HEIGHT, layoutHeight(summary.length, sections));

      const canvas = document.createElement("canvas");
      // Drawn at device scale so the text is not soft on the screen it
      // ends up on — a picture made to be looked at on a phone.
      const scale = 2;
      canvas.width = WIDTH * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(scale, scale);

      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, WIDTH, height);

      const right = WIDTH - PAD;
      let y = PAD + 56;

      ctx.textAlign = "left";
      ctx.fillStyle = INK;
      ctx.font = font(52, 700);
      ctx.fillText(period, PAD, y);
      ctx.textAlign = "right";
      ctx.fillStyle = INK_FAINT;
      ctx.font = font(30);
      ctx.fillText(labels.title, right, y);
      y += 40;

      for (const line of summary) {
        ctx.textAlign = "left";
        ctx.fillStyle = INK_MUTED;
        ctx.font = font(30);
        ctx.fillText(line.label, PAD, y + 32);
        ctx.textAlign = "right";
        ctx.fillStyle = INK;
        ctx.font = font(34, 700);
        ctx.fillText(line.value, right, y + 32);
        y += 56;
      }

      for (const section of sections) {
        y += SECTION_GAP;

        ctx.textAlign = "left";
        ctx.fillStyle = INK;
        ctx.font = font(38, 700);
        ctx.fillText(section.label, PAD, y);
        ctx.textAlign = "right";
        ctx.font = font(34, 700);
        ctx.fillStyle = section.over ? NEGATIVE : INK;
        ctx.fillText(
          section.budget === null ? section.actual : `${section.actual} / ${section.budget}`,
          right,
          y,
        );
        y += 22;

        ctx.fillStyle = RULE;
        roundRect(ctx, PAD, y, right - PAD, 12, 6);
        ctx.fillStyle = section.over ? NEGATIVE : ACCENT;
        roundRect(ctx, PAD, y, ((right - PAD) * section.bar) / 100, 12, 6);
        y += 60;

        for (const band of section.bands) {
          if (band.category !== null) {
            ctx.fillStyle = BAND;
            roundRect(ctx, PAD, y - 34, right - PAD, 46, 10);
            ctx.textAlign = "left";
            ctx.fillStyle = INK_MUTED;
            ctx.font = font(28, 700);
            ctx.fillText(band.category, PAD + 18, y);
            y += BAND_H;
          }

          for (const row of band.rows) {
            ctx.textAlign = "left";
            ctx.fillStyle = INK;
            ctx.font = font(32);
            ctx.fillText(row.name, PAD + (band.category === null ? 0 : 18), y, 380);

            ctx.textAlign = "right";
            ctx.font = font(30, row.over ? 700 : 400);
            ctx.fillStyle = row.over ? NEGATIVE : INK_MUTED;
            const figures = row.budget === null ? row.actual : `${row.actual} / ${row.budget}`;
            ctx.fillText(
              row.over ? `${figures} · ${labels.over}` : figures,
              right,
              y,
              right - PAD - 400,
            );
            y += 18;

            ctx.fillStyle = RULE;
            roundRect(ctx, PAD + (band.category === null ? 0 : 18), y, right - PAD - 18, 8, 4);
            if (row.budget !== null) {
              ctx.fillStyle = row.over ? NEGATIVE : ACCENT;
              roundRect(
                ctx,
                PAD + (band.category === null ? 0 : 18),
                y,
                ((right - PAD - 18) * row.bar) / 100,
                8,
                4,
              );
            }
            y += ROW_H - 18;
          }
        }
      }

      ctx.textAlign = "left";
      ctx.fillStyle = ACCENT;
      ctx.font = font(26, 700);
      ctx.fillText("moneybook", PAD, Math.min(height - PAD, y + 50));

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `budget-${period}.png`.replace(/[\\/:*?"<>|–]/g, "-");
      // In the document before it is clicked: a detached anchor still
      // downloads, but the browser ignores its `download` attribute and
      // the file arrives called "download" with no extension.
      link.style.display = "none";
      document.body.append(link);
      link.click();
      link.remove();
      // Revoked a beat later, not immediately: the click only *starts*
      // the download, and pulling the blob out from under it mid-read is
      // what makes a browser fall back to a nameless file.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={draw}
      disabled={busy}
      data-testid="budget-image"
      className={`${buttonClass("ghost")} min-h-9 px-2.5 text-xs`}
    >
      {busy ? labels.saving : labels.save}
    </button>
  );
}
