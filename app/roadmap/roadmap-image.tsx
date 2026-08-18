"use client";

import { useState } from "react";
import { buttonClass } from "../_components/ui";

/** One year, already formatted — the canvas only ever draws strings. */
export interface RoadmapImageRow {
  year: string;
  plan: string;
  live: string;
  /** Null for a year the ledger cannot speak for. */
  actualRate: string | null;
  targetRate: string;
  /** Marks the years the ledger spoke for, so the image can say so too. */
  fromLedger: boolean;
}

export interface RoadmapImageLabels {
  save: string;
  saving: string;
  mask: string;
  title: string;
  year: string;
  plan: string;
  live: string;
  /** Short — 「실제수익률」 at this size collides with the column beside it. */
  actualRate: string;
  targetRate: string;
  /** Says what those two short headings are, under the table. */
  rateNote: string;
}

/** A phone screen, which is what the picture will be looked at on. */
const WIDTH = 1080;
const MIN_HEIGHT = 1920;
const PAD = 72;
const ROW_H = 56;

/**
 * A light palette, fixed rather than read off the page.
 *
 * The image outlives the theme it was made under — it gets sent to
 * someone, saved, looked at next year — so it should not come out dark
 * because of a setting that was true for a minute. These are the light
 * theme's own tokens, spelled out because canvas cannot read CSS
 * variables.
 */
const INK = "#191f28";
const INK_MUTED = "#4e5968";
const INK_FAINT = "#8b95a1";
const PAPER = "#ffffff";
const BAND = "#f2f4f6";
const RULE = "#edf0f3";
const ACCENT = "#4338ca";
const POSITIVE = "#0f7a3d";

const FAMILY =
  '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Pretendard, system-ui, "Malgun Gothic", sans-serif';
const font = (size: number, weight = 400) => `${weight} ${size}px ${FAMILY}`;

/**
 * The roadmap as a picture, laid out for a phone rather than screenshotted
 * from one.
 *
 * A screenshot of the table would carry whatever was scrolled into view
 * and nothing else — the years past the fold are exactly the ones worth
 * showing. So the image is drawn from the data instead: every year, one
 * per line, at a size meant to be read on a phone held at arm's length.
 *
 * Drawn on a canvas rather than rendered from the DOM. The alternative
 * is a library that re-implements CSS layout in JavaScript, which is a
 * large dependency to take on for one button and gets fonts, transforms
 * and overflow subtly wrong anyway.
 */
export function RoadmapImage({
  name,
  period,
  summary,
  rows,
  labels,
}: {
  name: string;
  period: string;
  /** The version's defaults, one per line under the name. */
  summary: readonly { label: string; value: string }[];
  rows: readonly RoadmapImageRow[];
  labels: RoadmapImageLabels;
}) {
  const [masked, setMasked] = useState(false);
  const [busy, setBusy] = useState(false);

  const draw = async () => {
    setBusy(true);
    try {
      // Korean at 60px is unreadable if the face falls back mid-draw, and
      // canvas takes no second pass once it has painted.
      await document.fonts.ready;

      // Worked out rather than guessed: the summary is three lines of
      // its own and the column headings sit under them, which is what a
      // fixed header height got wrong — the two overlapped.
      const titleY = PAD + 30;
      const nameY = titleY + 74;
      const periodY = nameY + 46;
      const summaryY = periodY + 52;
      const headerH = summaryY + summary.length * 34 + 44;
      const footerH = 150;
      const height = Math.max(MIN_HEIGHT, headerH + rows.length * ROW_H + footerH + PAD);
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Whether a real blur is available. Where it is not, the masked
      // figures get a solid band instead — unreadable either way, which
      // is the point, and never accidentally legible.
      ctx.filter = "blur(4px)";
      const canBlur = ctx.filter !== "none";
      ctx.filter = "none";

      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, WIDTH, height);

      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = INK_FAINT;
      ctx.font = font(30, 500);
      ctx.fillText(labels.title, PAD, titleY);

      ctx.fillStyle = INK;
      ctx.font = font(62, 700);
      ctx.fillText(name, PAD, nameY);

      ctx.fillStyle = INK_MUTED;
      ctx.font = font(34, 500);
      ctx.fillText(period, PAD, periodY);

      // Five columns on 1080px. The two rates are the point of the whole
      // table — what a year was aimed at and what it came to — so they
      // get their own space rather than being dropped for want of width;
      // the money simply sets a size that leaves room for them.
      const showActual = rows.some((r) => r.actualRate !== null);
      const colYear = PAD;
      const colTarget = WIDTH - PAD;
      const colActual = colTarget - 110;
      const colLive = (showActual ? colActual : colTarget) - 110;
      // Wide enough that a ten-digit figure still clears the column
      // beside it once the blur has smeared it sideways.
      const colPlan = colLive - 285;

      // The defaults as label/value pairs down the left and right, so a
      // long currency string wraps to its own column instead of running
      // off the edge the way one joined line did.
      summary.forEach((item, i) => {
        const baseline = summaryY + i * 34;
        ctx.textAlign = "left";
        ctx.fillStyle = INK_FAINT;
        ctx.font = font(26);
        ctx.fillText(item.label, PAD, baseline);
        ctx.textAlign = "right";
        ctx.fillStyle = INK_MUTED;
        ctx.font = font(26, 600);
        ctx.fillText(item.value, colPlan, baseline);
      });

      let y = headerH;
      ctx.font = font(24, 600);
      ctx.fillStyle = INK_FAINT;
      ctx.textAlign = "left";
      ctx.fillText(labels.year, colYear, y);
      ctx.textAlign = "right";
      ctx.fillText(labels.plan, colPlan, y);
      ctx.fillText(labels.live, colLive, y);
      if (showActual) ctx.fillText(labels.actualRate, colActual, y);
      ctx.fillText(labels.targetRate, colTarget, y);
      y += 24;

      ctx.strokeStyle = INK_FAINT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(PAD, y);
      ctx.lineTo(WIDTH - PAD, y);
      ctx.stroke();

      // A masked figure is drawn, then smeared. Drawing a placeholder
      // instead would make every row the same width and give away that
      // there was nothing to hide.
      const MONEY = 26;
      const money = (text: string, x: number, baseline: number, weight: number, color: string) => {
        ctx.font = font(MONEY, weight);
        if (!masked) {
          ctx.fillStyle = color;
          ctx.fillText(text, x, baseline);
          return;
        }
        if (canBlur) {
          ctx.save();
          ctx.filter = "blur(5px)";
          ctx.fillStyle = color;
          ctx.fillText(text, x, baseline);
          ctx.restore();
          return;
        }
        const w = ctx.measureText(text).width;
        ctx.fillStyle = RULE;
        ctx.fillRect(x - w, baseline - MONEY + 3, w, MONEY + 8);
      };

      rows.forEach((row, i) => {
        const top = y + i * ROW_H;
        const baseline = top + ROW_H / 2 + 12;

        if (i % 2 === 1) {
          ctx.fillStyle = BAND;
          ctx.fillRect(PAD - 16, top, WIDTH - (PAD - 16) * 2, ROW_H);
        }

        ctx.textAlign = "left";
        ctx.fillStyle = INK;
        ctx.font = font(30, 700);
        ctx.fillText(row.year, colYear, baseline);

        ctx.textAlign = "right";
        // Only the two money columns are hidden. The rates are the
        // reason to show anyone the picture and say nothing about how
        // much there is — a percentage is the same whether you have a
        // hundred thousand or a hundred million.
        money(row.plan, colPlan, baseline, 400, INK_MUTED);
        money(row.live, colLive, baseline, 700, INK);

        if (showActual) {
          ctx.font = font(27, 700);
          ctx.fillStyle = row.actualRate === null ? INK_FAINT : POSITIVE;
          ctx.fillText(row.actualRate ?? "—", colActual, baseline);
        }
        ctx.font = font(27, 400);
        ctx.fillStyle = INK_MUTED;
        ctx.fillText(row.targetRate, colTarget, baseline);

        if (row.fromLedger) {
          // Beside the year rather than the figure: the rates now sit
          // hard against the money columns and a mark between them would
          // read as belonging to whichever it was nearer.
          ctx.textAlign = "left";
          ctx.font = font(30, 700);
          const yearWidth = ctx.measureText(row.year).width;
          ctx.fillStyle = POSITIVE;
          ctx.font = font(22, 700);
          ctx.fillText("✓", colYear + yearWidth + 10, baseline);
        }
      });

      const bottom = y + rows.length * ROW_H;
      ctx.textAlign = "left";
      ctx.fillStyle = INK_FAINT;
      ctx.font = font(24);
      ctx.fillText(labels.rateNote, PAD, bottom + 46);

      ctx.fillStyle = ACCENT;
      ctx.font = font(26, 700);
      ctx.fillText("moneybook", PAD, Math.min(height - PAD, bottom + 100));

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `roadmap-${name}-${period}.png`.replace(/[\\/:*?"<>|\u2013]/g, "-");
      // In the document before it is clicked: a detached anchor still
      // downloads, but the browser ignores its `download` attribute and
      // the file arrives called "download" with no extension.
      link.style.display = "none";
      document.body.append(link);
      link.click();
      link.remove();
      // Revoked a beat later, not immediately: the click only *starts*
      // the download, and pulling the blob out from under it mid-read is
      // what makes a browser fall back to a nameless, extensionless file.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={draw}
        disabled={busy}
        data-testid="roadmap-image"
        className={buttonClass("secondary")}
      >
        {busy ? labels.saving : labels.save}
      </button>
      <label className="text-ink-muted flex min-h-12 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={masked}
          onChange={(e) => setMasked(e.target.checked)}
          data-testid="roadmap-image-mask"
          className="accent-accent size-5"
        />
        {labels.mask}
      </label>
    </div>
  );
}
