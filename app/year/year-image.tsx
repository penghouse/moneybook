"use client";

import { useRef, useState } from "react";
import { buttonClass } from "../_components/ui";

/** How a figure is inked. The server decides; the canvas only draws. */
export type YearImageTone = "ink" | "faint" | "good" | "bad" | "muted";

export interface YearImageCell {
  text: string;
  tone: YearImageTone;
}

export interface YearImageRow {
  label: string;
  /** Drives indent, weight and the rule above it. */
  level: "band" | "account" | "total" | "note";
  /** Twelve, oldest first. A null cell is drawn as nothing. */
  cells: (YearImageCell | null)[];
  /** The 합계 column. Null on rows that do not add up to anything. */
  total: YearImageCell | null;
}

export interface YearImageSection {
  /** 'expense' | 'income' | 'saving' — what the checkbox turns off. */
  key: string;
  label: string;
  rows: YearImageRow[];
}

export interface YearImageLabels {
  save: string;
  saving: string;
  confirm: string;
  close: string;
  title: string;
  line: string;
  total: string;
  /** '{n}월' / '{n}', the same template the table uses. */
  monthNumber: string;
  note: string;
}

/**
 * Wide, and only wide.
 *
 * Thirteen money columns do not go on a phone held upright — the budget
 * picture turns a long month into two or three columns precisely because
 * it has one column of figures to play with, and this has thirteen that
 * have to stay in a row or stop being a year. So the picture is a
 * landscape table, which is the shape this reading has on paper anyway.
 */
const WIDTH = 2040;
const PAD = 72;
const NAME_W = 300;
const COL_W = (WIDTH - PAD * 2 - NAME_W) / 13;

const ROW_H: Record<YearImageRow["level"], number> = {
  band: 48,
  account: 58,
  total: 64,
  note: 48,
};
const SECTION_GAP = 56;
/**
 * Room under the last row for the note and the wordmark.
 *
 * Both are placed from the bottom of the content rather than from the
 * bottom of the canvas, and the canvas is made tall enough to hold them:
 * measuring one from each end is how they ended up printed on top of
 * each other.
 */
const NOTE_DROP = 48;
const MARK_DROP = 104;
const SECTION_TITLE_H = 54;
const HEAD_ROW_H = 52;

/**
 * A light palette, fixed rather than read off the page.
 *
 * The image outlives the theme it was made under — it gets sent to
 * someone, saved, looked at next year — so it should not come out dark
 * because of a setting that was true for a minute.
 */
const INK = "#191f28";
const INK_MUTED = "#4e5968";
const INK_FAINT = "#8b95a1";
const PAPER = "#ffffff";
const BAND = "#f2f4f6";
const RULE = "#edf0f3";
const ACCENT = "#4338ca";
const POSITIVE = "#0f7a3d";
const NEGATIVE = "#c2372b";

const TONE: Record<YearImageTone, string> = {
  ink: INK,
  faint: INK_FAINT,
  good: POSITIVE,
  bad: NEGATIVE,
  muted: INK_MUTED,
};

const FAMILY =
  '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", Pretendard, system-ui, "Malgun Gothic", sans-serif';
const font = (size: number, weight = 400) => `${weight} ${size}px ${FAMILY}`;

function sectionHeight(section: YearImageSection): number {
  return (
    SECTION_GAP +
    SECTION_TITLE_H +
    HEAD_ROW_H +
    section.rows.reduce((sum, row) => sum + ROW_H[row.level], 0)
  );
}

/**
 * The year as one picture, drawn from the data rather than screenshotted.
 *
 * A screenshot of this table carries whichever three months were scrolled
 * into view, and the point of the table is the other nine. Drawing it
 * means the picture is the whole year every time.
 *
 * Which 분류 to include is asked here rather than left standing on the
 * page: it is a question with one answer per export — 지출만 for a
 * settlement, all three for a year-end — not a setting the screen has.
 */
export function YearImage({
  year,
  sections,
  labels,
}: {
  year: string;
  sections: readonly YearImageSection[];
  labels: YearImageLabels;
}) {
  const [chosen, setChosen] = useState<string[]>(() => sections.map((s) => s.key));
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  const picked = sections.filter((s) => chosen.includes(s.key));

  const draw = async () => {
    setBusy(true);
    try {
      // Korean at this size is unreadable if the face falls back
      // mid-draw, and canvas takes no second pass once it has painted.
      await document.fonts.ready;

      const headerBottom = PAD + 30 + 74 + 46 + 30;
      const height = headerBottom + picked.reduce((sum, s) => sum + sectionHeight(s), 0) + PAD + 60;

      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, WIDTH, height);

      ctx.textAlign = "left";
      ctx.fillStyle = INK_FAINT;
      ctx.font = font(26, 600);
      ctx.fillText(labels.title, PAD, PAD + 30);
      ctx.fillStyle = INK;
      ctx.font = font(60, 700);
      ctx.fillText(year, PAD, PAD + 30 + 74);

      let y = headerBottom;
      const colX = (i: number) => PAD + NAME_W + (i + 1) * COL_W - 16;

      for (const section of picked) {
        y += SECTION_GAP;
        ctx.textAlign = "left";
        ctx.fillStyle = INK;
        ctx.font = font(38, 700);
        ctx.fillText(section.label, PAD, y);
        y += SECTION_TITLE_H;

        // The month headings, once per section: a reader scrolled to the
        // bottom of a long picture should not have to go back up to find
        // out which column is October.
        ctx.font = font(24, 600);
        ctx.fillStyle = INK_FAINT;
        ctx.textAlign = "left";
        ctx.fillText(labels.line, PAD, y);
        ctx.textAlign = "right";
        for (let i = 0; i < 12; i++) {
          ctx.fillText(labels.monthNumber.replace("{n}", String(i + 1)), colX(i), y);
        }
        ctx.fillText(labels.total, colX(12), y);
        y += 14;
        ctx.strokeStyle = INK_FAINT;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(PAD, y);
        ctx.lineTo(WIDTH - PAD, y);
        ctx.stroke();
        y += HEAD_ROW_H - 14;

        for (const row of section.rows) {
          const h = ROW_H[row.level];
          const baseline = y + h / 2 + 10;

          if (row.level === "band") {
            ctx.fillStyle = BAND;
            ctx.beginPath();
            ctx.roundRect(PAD, y + 4, WIDTH - PAD * 2, h - 8, 10);
            ctx.fill();
          } else if (row.level === "total") {
            ctx.strokeStyle = INK_FAINT;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(PAD, y + 2);
            ctx.lineTo(WIDTH - PAD, y + 2);
            ctx.stroke();
          } else {
            ctx.strokeStyle = RULE;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(PAD, y + 2);
            ctx.lineTo(WIDTH - PAD, y + 2);
            ctx.stroke();
          }

          const heavy = row.level === "total";
          const small = row.level === "band" || row.level === "note";
          ctx.textAlign = "left";
          ctx.fillStyle = row.level === "account" ? INK : INK_MUTED;
          ctx.font = font(small ? 24 : 28, heavy || row.level === "band" ? 700 : 400);
          ctx.fillText(row.label, PAD + (row.level === "account" ? 18 : 0), baseline, NAME_W - 24);

          ctx.textAlign = "right";
          ctx.font = font(small ? 24 : 26, heavy ? 700 : 500);
          row.cells.forEach((cell, i) => {
            if (!cell) return;
            ctx.fillStyle = TONE[cell.tone];
            ctx.fillText(cell.text, colX(i), baseline, COL_W - 12);
          });
          if (row.total) {
            ctx.fillStyle = TONE[row.total.tone];
            ctx.font = font(small ? 24 : 26, 700);
            ctx.fillText(row.total.text, colX(12), baseline, COL_W - 12);
          }
          y += h;
        }
      }

      ctx.textAlign = "left";
      ctx.fillStyle = INK_FAINT;
      ctx.font = font(24);
      ctx.fillText(labels.note, PAD, y + NOTE_DROP);
      ctx.fillStyle = ACCENT;
      ctx.font = font(26, 700);
      ctx.fillText("moneybook", PAD, y + MARK_DROP);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `year-${year}.png`.replace(/[\\/:*?"<>|–]/g, "-");
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
        data-testid="year-image"
        className={buttonClass("secondary")}
      >
        {labels.save}
      </button>

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
                data-testid={`year-image-${section.key}`}
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
            disabled={busy || picked.length === 0}
            data-testid="year-image-confirm"
            className={buttonClass("primary", true)}
          >
            {busy ? labels.saving : labels.confirm}
          </button>
        </div>
      </dialog>
    </>
  );
}
