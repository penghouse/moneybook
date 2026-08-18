"use client";

import { useState } from "react";
import { buttonClass, controlClass } from "../_components/ui";

/** One year, already formatted — the canvas only ever draws strings. */
export interface RoadmapImageRow {
  year: string;
  plan: string;
  live: string;
  /** The same two figures said short — '32.47억'. Null below any unit. */
  planShort: string | null;
  liveShort: string | null;
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
  rounded: string;
  shape: string;
  shapeTall: string;
  shapeWide: string;
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

const PAD = 72;
/** A phone held upright, which is where a picture like this is looked at. */
const TALL = { width: 1080, minHeight: 1920, rowH: 56 };
/** Turned on its side, for the years-across reading. */
const WIDE = { width: 1920, minHeight: 1080 };

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

type Shape = "tall" | "wide";
type Hide = (text: string, x: number, baseline: number, fontSize: number) => void;
type Pick = (row: RoadmapImageRow) => string;

/**
 * The roadmap as a picture, laid out for sharing rather than screenshotted.
 *
 * A screenshot carries whatever was scrolled into view and nothing else —
 * the years past the fold are exactly the ones worth showing. So the
 * image is drawn from the data instead, on a canvas: the alternative is
 * a library that re-implements CSS layout in JavaScript, which is a
 * large dependency for one button and gets fonts and overflow subtly
 * wrong anyway.
 *
 * Three choices, because one picture cannot serve every reason for
 * making one:
 *
 * - **세로 / 가로.** Upright is a year per line, the reading that fits a
 *   phone. On its side the years run across and the four figures stack
 *   under each — the shape a spreadsheet has, and the one that shows a
 *   decade at a time.
 * - **어림수.** 32.47억 instead of ₩3,247,105,906. Ten digits is a
 *   number nobody reads; they count the commas.
 * - **가리기.** Blurs the two money rows and leaves the rates, because
 *   the rates are the reason to show someone the picture and say nothing
 *   about how much there is.
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
  const [rounded, setRounded] = useState(false);
  const [shape, setShape] = useState<Shape>("tall");
  const [busy, setBusy] = useState(false);

  /**
   * Rounded where a unit exists, exact where it does not — a small
   * figure has no 억 to be said in, and the exact number beats an
   * invented one.
   */
  const plan: Pick = (row) => (rounded && row.planShort) || row.plan;
  const live: Pick = (row) => (rounded && row.liveShort) || row.live;

  const draw = async () => {
    setBusy(true);
    try {
      // Korean at 60px is unreadable if the face falls back mid-draw, and
      // canvas takes no second pass once it has painted.
      await document.fonts.ready;

      const measure = document.createElement("canvas").getContext("2d");
      if (!measure) return;

      const size =
        shape === "tall"
          ? tallSize(rows.length, summary.length)
          : wideSize(rows, summary.length, measure, plan, live);

      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Whether a real blur is available. Where it is not, the masked
      // figures get a solid band instead — unreadable either way, which
      // is the point, and never accidentally legible.
      ctx.filter = "blur(4px)";
      const canBlur = ctx.filter !== "none";
      ctx.filter = "none";

      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, size.width, size.height);
      const headerBottom = drawHeader(ctx, { name, period, summary, labels, width: size.width });

      const hide: Hide = (text, x, baseline, fontSize) => {
        if (canBlur) {
          ctx.save();
          ctx.filter = "blur(5px)";
          ctx.fillText(text, x, baseline);
          ctx.restore();
          return;
        }
        const w = ctx.measureText(text).width;
        const fill = ctx.fillStyle;
        ctx.fillStyle = RULE;
        ctx.fillRect(x - w, baseline - fontSize + 3, w, fontSize + 8);
        ctx.fillStyle = fill;
      };

      const bottom =
        shape === "tall"
          ? drawTall(ctx, { rows, labels, headerBottom, masked, hide, plan, live })
          : drawWide(ctx, {
              rows,
              labels,
              headerBottom,
              masked,
              hide,
              plan,
              live,
              width: size.width,
              measure,
            });

      ctx.textAlign = "left";
      ctx.fillStyle = INK_FAINT;
      ctx.font = font(24);
      ctx.fillText(labels.rateNote, PAD, bottom + 46);
      ctx.fillStyle = ACCENT;
      ctx.font = font(26, 700);
      ctx.fillText("moneybook", PAD, Math.min(size.height - PAD, bottom + 100));

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `roadmap-${name}-${period}.png`.replace(/[\\/:*?"<>|–]/g, "-");
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

      <select
        value={shape}
        onChange={(e) => setShape(e.target.value as Shape)}
        aria-label={labels.shape}
        data-testid="roadmap-image-shape"
        className={`${controlClass} w-auto`}
      >
        <option value="tall">{labels.shapeTall}</option>
        <option value="wide">{labels.shapeWide}</option>
      </select>

      <label className="text-ink-muted flex min-h-12 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={rounded}
          onChange={(e) => setRounded(e.target.checked)}
          data-testid="roadmap-image-rounded"
          className="accent-accent size-5"
        />
        {labels.rounded}
      </label>

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

// ---- Shared ----

function headerHeight(summaryLines: number): number {
  return PAD + 30 + 74 + 46 + 52 + summaryLines * 34 + 44;
}

/**
 * The header, identical in both shapes so a reader who has seen one
 * recognises the other.
 */
function drawHeader(
  ctx: CanvasRenderingContext2D,
  params: {
    name: string;
    period: string;
    summary: readonly { label: string; value: string }[];
    labels: RoadmapImageLabels;
    width: number;
  },
): number {
  const titleY = PAD + 30;
  const nameY = titleY + 74;
  const periodY = nameY + 46;
  const summaryY = periodY + 52;

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = INK_FAINT;
  ctx.font = font(30, 500);
  ctx.fillText(params.labels.title, PAD, titleY);

  ctx.fillStyle = INK;
  ctx.font = font(62, 700);
  ctx.fillText(params.name, PAD, nameY);

  ctx.fillStyle = INK_MUTED;
  ctx.font = font(34, 500);
  ctx.fillText(params.period, PAD, periodY);

  // Values right-aligned to one stop, so a long currency string wraps to
  // its own column instead of running off the edge.
  const valueX = Math.min(560, params.width - PAD);
  params.summary.forEach((item, i) => {
    const baseline = summaryY + i * 34;
    ctx.textAlign = "left";
    ctx.fillStyle = INK_FAINT;
    ctx.font = font(26);
    ctx.fillText(item.label, PAD, baseline);
    ctx.textAlign = "right";
    ctx.fillStyle = INK_MUTED;
    ctx.font = font(26, 600);
    ctx.fillText(item.value, valueX, baseline);
  });

  return headerHeight(params.summary.length);
}

// ---- Tall ----

function tallSize(rowCount: number, summaryLines: number) {
  return {
    width: TALL.width,
    height: Math.max(TALL.minHeight, headerHeight(summaryLines) + rowCount * TALL.rowH + 150 + PAD),
  };
}

/** A year per line: five columns, the reading a phone can hold. */
function drawTall(
  ctx: CanvasRenderingContext2D,
  params: {
    rows: readonly RoadmapImageRow[];
    labels: RoadmapImageLabels;
    headerBottom: number;
    masked: boolean;
    hide: Hide;
    plan: Pick;
    live: Pick;
  },
): number {
  const { rows, labels, masked, hide } = params;
  const showActual = rows.some((r) => r.actualRate !== null);
  const colYear = PAD;
  const colTarget = TALL.width - PAD;
  const colActual = colTarget - 110;
  const colLive = (showActual ? colActual : colTarget) - 110;
  // Wide enough that a ten-digit figure still clears the column beside
  // it once the blur has smeared it sideways.
  const colPlan = colLive - 285;

  let y = params.headerBottom;
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
  ctx.lineTo(TALL.width - PAD, y);
  ctx.stroke();

  const MONEY = 26;
  const money = (text: string, x: number, baseline: number, weight: number, color: string) => {
    ctx.font = font(MONEY, weight);
    ctx.fillStyle = color;
    ctx.textAlign = "right";
    if (masked) hide(text, x, baseline, MONEY);
    else ctx.fillText(text, x, baseline);
  };

  rows.forEach((row, i) => {
    const top = y + i * TALL.rowH;
    const baseline = top + TALL.rowH / 2 + 12;

    if (i % 2 === 1) {
      ctx.fillStyle = BAND;
      ctx.fillRect(PAD - 16, top, TALL.width - (PAD - 16) * 2, TALL.rowH);
    }

    ctx.textAlign = "left";
    ctx.fillStyle = INK;
    ctx.font = font(30, 700);
    ctx.fillText(row.year, colYear, baseline);
    if (row.fromLedger) {
      // Beside the year rather than the figure: the rates sit hard
      // against the money columns and a mark between them would read as
      // belonging to whichever it was nearer.
      const yearWidth = ctx.measureText(row.year).width;
      ctx.fillStyle = POSITIVE;
      ctx.font = font(22, 700);
      ctx.fillText("✓", colYear + yearWidth + 10, baseline);
    }

    money(params.plan(row), colPlan, baseline, 400, INK_MUTED);
    money(params.live(row), colLive, baseline, 700, INK);

    ctx.textAlign = "right";
    if (showActual) {
      ctx.font = font(26, 700);
      ctx.fillStyle = row.actualRate === null ? INK_FAINT : POSITIVE;
      ctx.fillText(row.actualRate ?? "—", colActual, baseline);
    }
    ctx.font = font(26, 400);
    ctx.fillStyle = INK_MUTED;
    ctx.fillText(row.targetRate, colTarget, baseline);
  });

  return y + rows.length * TALL.rowH;
}

// ---- Wide ----

const WIDE_LABEL_W = 190;
const WIDE_ROW_H = 46;
const WIDE_MONEY = 24;
const WIDE_BLOCK_GAP = 46;

/**
 * How many years fit across, and therefore how many bands the years are
 * broken into.
 *
 * Measured rather than guessed: the answer is completely different for
 * ₩3,247,105,906 and 32.47억, and one number for both would either
 * waste half the width or run the columns together.
 */
function wideColumns(
  rows: readonly RoadmapImageRow[],
  measure: CanvasRenderingContext2D,
  plan: Pick,
  live: Pick,
): { perBlock: number; colWidth: number } {
  measure.font = font(WIDE_MONEY, 700);
  let widest = 0;
  for (const row of rows) {
    widest = Math.max(
      widest,
      measure.measureText(plan(row)).width,
      measure.measureText(live(row)).width,
    );
  }
  const colWidth = Math.max(110, widest + 30);
  const room = WIDE.width - PAD * 2 - WIDE_LABEL_W;
  return { perBlock: Math.max(3, Math.floor(room / colWidth)), colWidth };
}

/** Year heading plus one line per figure. */
function wideLineCount(rows: readonly RoadmapImageRow[]): number {
  return rows.some((r) => r.actualRate !== null) ? 5 : 4;
}

function wideSize(
  rows: readonly RoadmapImageRow[],
  summaryLines: number,
  measure: CanvasRenderingContext2D,
  plan: Pick,
  live: Pick,
) {
  const { perBlock } = wideColumns(rows, measure, plan, live);
  const blocks = Math.max(1, Math.ceil(rows.length / perBlock));
  const body = blocks * (wideLineCount(rows) * WIDE_ROW_H + WIDE_BLOCK_GAP);
  return {
    width: WIDE.width,
    height: Math.max(WIDE.minHeight, headerHeight(summaryLines) + body + 150 + PAD),
  };
}

/**
 * Years across, figures stacked under each — the shape the spreadsheet
 * this replaces had, and the one that shows a decade at a time.
 *
 * Broken into bands rather than run off the edge: forty years across
 * 1920px is 48px a year, which is not a number anyone can read.
 */
function drawWide(
  ctx: CanvasRenderingContext2D,
  params: {
    rows: readonly RoadmapImageRow[];
    labels: RoadmapImageLabels;
    headerBottom: number;
    masked: boolean;
    hide: Hide;
    plan: Pick;
    live: Pick;
    width: number;
    measure: CanvasRenderingContext2D;
  },
): number {
  const { rows, labels, masked, hide } = params;
  const showActual = rows.some((r) => r.actualRate !== null);
  const { perBlock, colWidth } = wideColumns(rows, params.measure, params.plan, params.live);

  const lines: {
    label: string;
    pick: (row: RoadmapImageRow) => string | null;
    weight: number;
    money: boolean;
    color: string;
  }[] = [
    { label: labels.plan, pick: params.plan, weight: 400, money: true, color: INK_MUTED },
    { label: labels.live, pick: params.live, weight: 700, money: true, color: INK },
    ...(showActual
      ? [
          {
            label: labels.actualRate,
            pick: (r: RoadmapImageRow) => r.actualRate,
            weight: 700,
            money: false,
            color: POSITIVE,
          },
        ]
      : []),
    {
      label: labels.targetRate,
      pick: (r: RoadmapImageRow) => r.targetRate,
      weight: 400,
      money: false,
      color: INK_MUTED,
    },
  ];

  let y = params.headerBottom;
  for (let start = 0; start < rows.length; start += perBlock) {
    const band = rows.slice(start, start + perBlock);
    const xOf = (i: number) => PAD + WIDE_LABEL_W + (i + 1) * colWidth - 16;

    ctx.textAlign = "left";
    ctx.fillStyle = INK_FAINT;
    ctx.font = font(24, 600);
    ctx.fillText(labels.year, PAD, y + 30);
    band.forEach((row, i) => {
      ctx.textAlign = "right";
      ctx.fillStyle = INK;
      ctx.font = font(28, 700);
      ctx.fillText(row.year, xOf(i), y + 30);
      if (row.fromLedger) {
        ctx.fillStyle = POSITIVE;
        ctx.font = font(20, 700);
        ctx.textAlign = "left";
        ctx.fillText("✓", xOf(i) + 4, y + 30);
      }
    });
    y += WIDE_ROW_H;

    ctx.strokeStyle = INK_FAINT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, y - 12);
    ctx.lineTo(params.width - PAD, y - 12);
    ctx.stroke();

    lines.forEach((line, li) => {
      const top = y + li * WIDE_ROW_H;
      const baseline = top + WIDE_ROW_H / 2 + 9;
      if (li % 2 === 1) {
        ctx.fillStyle = BAND;
        ctx.fillRect(PAD - 16, top, params.width - (PAD - 16) * 2, WIDE_ROW_H);
      }

      ctx.textAlign = "left";
      ctx.fillStyle = INK_FAINT;
      ctx.font = font(24, 600);
      ctx.fillText(line.label, PAD, baseline);

      band.forEach((row, i) => {
        const value = line.pick(row);
        ctx.textAlign = "right";
        ctx.font = font(WIDE_MONEY, line.weight);
        ctx.fillStyle = value === null ? INK_FAINT : line.color;
        const text = value ?? "—";
        if (line.money && masked) hide(text, xOf(i), baseline, WIDE_MONEY);
        else ctx.fillText(text, xOf(i), baseline);
      });
    });

    y += lines.length * WIDE_ROW_H + WIDE_BLOCK_GAP;
  }

  return y - WIDE_BLOCK_GAP;
}
