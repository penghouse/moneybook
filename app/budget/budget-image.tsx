"use client";

import { useRef, useState } from "react";
import { summaryBelongs } from "@/lib/budget-view";
import { columnCountFor, packColumns, type Sliver } from "@/lib/image-columns";
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
  /** 'income' | 'expense' — what the checkbox in the dialog turns off. */
  key: string;
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
  confirm: string;
  close: string;
  title: string;
  uncategorized: string;
  over: string;
}

/** Wide enough to read on a phone, which is where this gets looked at. */
const COLUMN_W = 1080;
const COLUMN_GAP = 56;
/**
 * How tall one column is allowed to get before the content moves into
 * another.
 *
 * A month of two dozen items came out three times taller than it was
 * wide — a strip to scroll rather than something to look at. Columns
 * trade width for height, and past about a page and a half of height the
 * trade is worth making.
 */
const COLUMN_MAX_H = 1700;
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
 * One drawable piece, and how tall it is.
 *
 * The heights are worked out once, here, and the drawing then walks the
 * same list — two copies of this arithmetic is two chances to leave a
 * band of blank paper under the last row, which is the thing the picture
 * is for getting rid of.
 */
type Piece =
  | { kind: "section"; section: BudgetImageSection }
  | { kind: "band"; label: string }
  | { kind: "row"; row: BudgetImageRow; band: string | null };

const PIECE_H: Record<Piece["kind"], number> = {
  section: SECTION_GAP + 22 + 60,
  band: BAND_H,
  row: ROW_H,
};

function piecesOf(sections: readonly BudgetImageSection[]): Piece[] {
  const pieces: Piece[] = [];
  for (const section of sections) {
    pieces.push({ kind: "section", section });
    for (const band of section.bands) {
      if (band.category !== null) pieces.push({ kind: "band", label: band.category });
      for (const row of band.rows) {
        pieces.push({ kind: "row", row, band: band.category });
      }
    }
  }
  return pieces;
}

const sliversOf = (pieces: readonly Piece[]): Sliver[] =>
  pieces.map((piece) => ({ height: PIECE_H[piece.kind], header: piece.kind !== "row" }));

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
  // Both sides to begin with: a settlement is 수입 − 지출, and the月's
  // saving is the figure the page leads with. Turning one off is for the
  // months when only half of it is the point.
  const [chosen, setChosen] = useState<readonly string[]>(sections.map((s) => s.key));
  const dialog = useRef<HTMLDialogElement>(null);

  const draw = async () => {
    setBusy(true);
    try {
      const picked = sections.filter((section) => chosen.includes(section.key));
      if (picked.length === 0) return;

      const lines = summaryBelongs(picked.length, sections.length) ? summary : [];

      const pieces = piecesOf(picked);
      const slivers = sliversOf(pieces);
      const head = PAD + 56 + 40 + lines.length * 56;
      const body = slivers.reduce((sum, sliver) => sum + sliver.height, 0);
      const columns = packColumns(slivers, columnCountFor(body, COLUMN_MAX_H));

      const width = COLUMN_W * columns.length + COLUMN_GAP * (columns.length - 1);
      /**
       * A column that opens mid-band repeats the heading.
       *
       * Rows under no heading are rows nobody can read: the 상위 그룹 is
       * what says whether ₩60,000 was food or fuel, and it stayed behind
       * in the previous column.
       */
      const continues = (column: readonly number[]) => {
        const first = pieces[column[0]];
        return first !== undefined && first.kind === "row" ? first.band : null;
      };
      const tallest = Math.max(
        ...columns.map(
          (column, index) =>
            column.reduce((sum, i) => sum + slivers[i].height, 0) +
            (index > 0 && continues(column) !== null ? BAND_H : 0),
        ),
      );
      // The footer's baseline, and room under it to match the margin above.
      const height = Math.max(MIN_HEIGHT, head + tallest + 50 + PAD);

      const canvas = document.createElement("canvas");
      // Drawn at device scale so the text is not soft on the screen it
      // ends up on — a picture made to be looked at on a phone.
      const scale = 2;
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(scale, scale);

      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, width, height);

      let y = PAD + 56;
      ctx.textAlign = "left";
      ctx.fillStyle = INK;
      ctx.font = font(52, 700);
      ctx.fillText(period, PAD, y);
      ctx.textAlign = "right";
      ctx.fillStyle = INK_FAINT;
      ctx.font = font(30);
      ctx.fillText(labels.title, width - PAD, y);
      y += 40;

      // The summary spans the whole sheet, above the columns: 저축 is the
      // month's answer, not a part of either side.
      for (const line of lines) {
        ctx.textAlign = "left";
        ctx.fillStyle = INK_MUTED;
        ctx.font = font(30);
        ctx.fillText(line.label, PAD, y + 32);
        ctx.textAlign = "right";
        ctx.fillStyle = INK;
        ctx.font = font(34, 700);
        // The first column's right edge, not the sheet's: spanning every
        // column would hang these figures over the second column's own,
        // a hand's breadth above them.
        ctx.fillText(line.value, COLUMN_W - PAD, y + 32);
        y += 56;
      }

      const top = y + 20;
      columns.forEach((column, index) => {
        const left = PAD + index * (COLUMN_W + COLUMN_GAP);
        const right = left + COLUMN_W - PAD * 2;
        let cy = top;

        const carried = index > 0 ? continues(column) : null;
        if (carried !== null) {
          ctx.fillStyle = BAND;
          roundRect(ctx, left, cy - 34, right - left, 46, 10);
          ctx.textAlign = "left";
          ctx.fillStyle = INK_MUTED;
          ctx.font = font(28, 700);
          ctx.fillText(carried, left + 18, cy);
          cy += BAND_H;
        }

        for (const i of column) {
          const piece = pieces[i];

          if (piece.kind === "section") {
            const { section } = piece;
            cy += SECTION_GAP;
            ctx.textAlign = "left";
            ctx.fillStyle = INK;
            ctx.font = font(38, 700);
            ctx.fillText(section.label, left, cy);
            ctx.textAlign = "right";
            ctx.font = font(34, 700);
            ctx.fillStyle = section.over ? NEGATIVE : INK;
            ctx.fillText(
              section.budget === null ? section.actual : `${section.actual} / ${section.budget}`,
              right,
              cy,
            );
            cy += 22;
            ctx.fillStyle = RULE;
            roundRect(ctx, left, cy, right - left, 12, 6);
            ctx.fillStyle = section.over ? NEGATIVE : ACCENT;
            roundRect(ctx, left, cy, ((right - left) * section.bar) / 100, 12, 6);
            cy += 60;
            continue;
          }

          if (piece.kind === "band") {
            ctx.fillStyle = BAND;
            roundRect(ctx, left, cy - 34, right - left, 46, 10);
            ctx.textAlign = "left";
            ctx.fillStyle = INK_MUTED;
            ctx.font = font(28, 700);
            ctx.fillText(piece.label, left + 18, cy);
            cy += BAND_H;
            continue;
          }

          const { row } = piece;
          const rowLeft = left + (piece.band !== null ? 18 : 0);
          ctx.textAlign = "left";
          ctx.fillStyle = INK;
          ctx.font = font(32);
          ctx.fillText(row.name, rowLeft, cy, 340);

          ctx.textAlign = "right";
          ctx.font = font(30, row.over ? 700 : 400);
          ctx.fillStyle = row.over ? NEGATIVE : INK_MUTED;
          const figures = row.budget === null ? row.actual : `${row.actual} / ${row.budget}`;
          ctx.fillText(
            row.over ? `${figures} · ${labels.over}` : figures,
            right,
            cy,
            right - rowLeft - 360,
          );
          cy += 18;

          ctx.fillStyle = RULE;
          roundRect(ctx, rowLeft, cy, right - rowLeft, 8, 4);
          if (row.budget !== null) {
            ctx.fillStyle = row.over ? NEGATIVE : ACCENT;
            roundRect(ctx, rowLeft, cy, ((right - rowLeft) * row.bar) / 100, 8, 4);
          }
          cy += ROW_H - 18;
        }
      });

      ctx.textAlign = "left";
      ctx.fillStyle = ACCENT;
      ctx.font = font(26, 700);
      ctx.fillText("moneybook", PAD, height - PAD);

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
      dialog.current?.close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        data-testid="budget-image"
        className={buttonClass("secondary")}
      >
        {labels.save}
      </button>

      {/* Asked at the moment a picture is being made, not left standing
          under the heading: which sides to include is a question with one
          answer per export, and a pair of checkboxes above the budget
          would read as settings the page has. */}
      <dialog
        ref={dialog}
        aria-label={labels.save}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
        className="bg-card rounded-card text-ink m-auto w-[min(24rem,calc(100vw-1.5rem))] p-0 backdrop:bg-black/50"
      >
        <div className="border-rule-soft flex min-h-12 items-center gap-2 border-b px-4">
          <h2 className="min-w-0 flex-1 truncate font-semibold">{labels.save}</h2>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label={labels.close}
            className="text-ink-faint hover:text-ink -mr-2 grid h-11 w-11 shrink-0 place-items-center text-xl"
          >
            ✕
          </button>
        </div>

        <div className="space-y-2 px-4 py-4">
          {sections.map((section) => (
            <label
              key={section.key}
              className="text-ink-muted flex min-h-12 items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={chosen.includes(section.key)}
                onChange={(e) =>
                  setChosen(
                    e.target.checked
                      ? [...chosen, section.key]
                      : chosen.filter((key) => key !== section.key),
                  )
                }
                data-testid={`budget-image-${section.key}`}
                className="accent-accent size-5"
              />
              {section.label}
            </label>
          ))}

          <button
            type="button"
            onClick={draw}
            // Nothing chosen is not a picture, and a button that produces
            // a blank page on request is worse than one that waits.
            disabled={busy || chosen.length === 0}
            data-testid="budget-image-confirm"
            className={buttonClass("primary", true)}
          >
            {busy ? labels.saving : labels.confirm}
          </button>
        </div>
      </dialog>
    </>
  );
}
