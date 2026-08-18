"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import type { AccountGroup } from "@/db/schema";
import { AccountCombobox, type ComboboxAccount } from "./account-combobox";
import { useDialogClose } from "./dialog";
import { SubmitButton } from "./submit-button";
import { buttonClass, controlClass, Label } from "./ui";
import { matchesQuery } from "@/lib/hangul";
import { convertMinorUnits, formatMoney, toMinorUnits } from "@/lib/money";

export interface EntryFormLabels {
  date: string;
  title: string;
  memo: string;
  details: string;
  amount: string;
  rate: string;
  left: string;
  right: string;
  leftHint: string;
  rightHint: string;
  split: string;
  swap: string;
  addLine: string;
  removeLine: string;
  save: string;
  saving: string;
  balanced: string;
  unbalanced: string;
  difference: string;
  namePlaceholder: string;
  /** Shown when a save's answer never came back. */
  unconfirmed: string;
  /** 분류 names, shown beside each account in the picker. */
  groups: Record<AccountGroup, string>;
}

interface Line {
  key: string;
  side: "left" | "right";
  accountId: string;
  currency: string;
  amountStr: string;
  rate: number | null;
  memo: string;
}

export type EntryFormAccount = ComboboxAccount;

export interface TitleSuggestion {
  title: string;
  leftAccountId: string | null;
  rightAccountId: string | null;
}

let keySeq = 0;
function newKey() {
  keySeq += 1;
  return `l${keySeq}`;
}

function emptyLine(side: "left" | "right"): Line {
  return {
    key: newKey(),
    side,
    accountId: "",
    currency: "",
    amountStr: "",
    rate: null,
    memo: "",
  };
}

export interface EntryFormInitial {
  /**
   * Present when the form edits that transaction in place. Absent when
   * the values are a copy to be saved as a *new* record — same prefill,
   * opposite outcome, and the id is the only thing that decides which.
   */
  transactionId?: string;
  date: string;
  title: string;
  memo: string;
  lines: {
    side: "left" | "right";
    accountId: string;
    currency: string;
    amountMajor: number;
    rate: number | null;
    memo: string;
  }[];
}

const SwapIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 7h12l-3-3M17 13H5l3 3" />
  </svg>
);

export function EntryForm({
  action,
  accounts,
  baseCurrency,
  defaultDate,
  locale,
  labels,
  initial,
  suggestions = [],
  afterSaveHref,
}: {
  action: (formData: FormData) => void | Promise<void>;
  accounts: EntryFormAccount[];
  baseCurrency: string;
  defaultDate: string;
  locale: string;
  labels: EntryFormLabels;
  initial?: EntryFormInitial;
  /** Recent 적요 with the accounts each was last posted between. */
  suggestions?: TitleSuggestion[];
  /**
   * Where to go once a save lands. Used by the duplicate flow to drop
   * `?duplicate=` from the URL: left there, the form would re-fill from
   * the transaction just copied and the next 저장 would quietly file a
   * third one.
   */
  afterSaveHref?: string;
}) {
  const amountInputRef = useRef<HTMLInputElement>(null);
  const closeDialog = useDialogClose();
  const router = useRouter();

  // Server actions passed straight to `action` give no hook to run code
  // after they resolve, but the plan calls for clearing amount/title
  // while keeping date and the selected accounts on repeated entry —
  // useActionState's returned state is what makes that possible.
  //
  // The catch is not decoration. A rejected reducer never settles the
  // transition, so 저장 중… stayed on the button for good — and since
  // the request had reached the server, the transaction was already
  // written. Reloading showed it saved while the screen still said it
  // was saving.
  const [saved, dispatch] = useActionState(
    async (state: { count: number; unconfirmed: boolean }, formData: FormData) => {
      try {
        await action(formData);
        return { count: state.count + 1, unconfirmed: false };
      } catch (error) {
        // redirect() and notFound() travel as errors and belong to the
        // framework; swallowing them would break both.
        unstable_rethrow(error);
        // The re-read happens in an effect, not here: refreshing inside
        // the transition discards the state this returns, and the notice
        // never painted at all.
        return { count: state.count, unconfirmed: true };
      }
    },
    { count: 0, unconfirmed: false },
  );
  const submitCount = saved.count;
  const lastSubmitCount = useRef(0);

  const [date, setDate] = useState(initial?.date ?? defaultDate);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [lines, setLines] = useState<Line[]>(
    initial
      ? initial.lines.map((l) => ({
          key: newKey(),
          side: l.side,
          accountId: l.accountId,
          currency: l.currency,
          amountStr: l.amountMajor ? String(l.amountMajor) : "",
          rate: l.rate,
          memo: l.memo,
        }))
      : [emptyLine("left"), emptyLine("right")],
  );
  const [splitForced, setSplitForced] = useState(
    !!initial &&
      (initial.lines.length > 2 || initial.lines.some((l) => l.currency !== baseCurrency)),
  );

  const isSimpleCurrencies = lines.every((l) => l.currency === "" || l.currency === baseCurrency);
  const showDetailed = splitForced || !isSimpleCurrencies || lines.length > 2;

  /** Prefilled from an existing transaction, but saving adds a new one. */
  const isDuplicate = !!initial && !initial.transactionId;
  const isEditing = !!initial?.transactionId;

  /**
   * Whether anything actually differs from the transaction being edited.
   *
   * Saving an unchanged transaction deletes and rewrites every one of
   * its lines for no gain, and against a hosted database that round trip
   * is long enough to read as the page having frozen. A button that
   * cannot be pressed until there is something to save says so before
   * the press rather than after it.
   *
   * Amounts are compared as numbers, not as the strings the inputs hold:
   * '12000' and '12000.0' are the same amount, and an empty box is the
   * zero it was rendered from.
   *
   * Only editing in place is gated on it. A duplicate is prefilled to be
   * identical on purpose, and a blank form has nothing to differ from.
   */
  const isDirty =
    !initial ||
    date !== initial.date ||
    title !== initial.title ||
    memo !== initial.memo ||
    lines.length !== initial.lines.length ||
    lines.some((l, i) => {
      const was = initial.lines[i];
      return (
        l.side !== was.side ||
        l.accountId !== was.accountId ||
        Number(l.amountStr || 0) !== was.amountMajor ||
        l.rate !== was.rate ||
        l.memo !== was.memo
      );
    });

  /**
   * Blank-form entry only: after a save, keep what the next transaction
   * is likely to share and clear what it cannot.
   *
   * The date and the two accounts carry over — that is the whole point
   * of entering a run of transactions in one sitting. Everything that
   * describes *this* transaction goes: the amount, the 적요, and both
   * kinds of memo. A memo left behind attaches itself to the next entry
   * silently, which is worse than retyping it.
   */
  useEffect(() => {
    if (!initial && submitCount > lastSubmitCount.current) {
      setTitle("");
      setMemo("");
      setLines((prev) => prev.map((l) => ({ ...l, amountStr: "", memo: "" })));
      amountInputRef.current?.focus();
    }
    lastSubmitCount.current = submitCount;
  }, [submitCount, initial]);

  // Editing inside a dialog: once the save lands the dialog's work is
  // done, so it closes itself. Null when the form is rendered inline,
  // which is what lets one component serve both.
  // Not "저장 실패": the answer went missing, and the write it was
  // answering for may well have landed — as it had every time this was
  // reported. So the list is re-read and the reader is told to check it,
  // which is the only honest thing to say.
  useEffect(() => {
    if (saved.unconfirmed) router.refresh();
  }, [saved.unconfirmed, router]);

  const lastClosedAt = useRef(0);
  useEffect(() => {
    if (submitCount > lastClosedAt.current) {
      if (initial) closeDialog?.();
      if (afterSaveHref) router.replace(afterSaveHref);
    }
    lastClosedAt.current = submitCount;
  }, [submitCount, initial, closeDialog, afterSaveHref, router]);

  const [titleOpen, setTitleOpen] = useState(false);

  // Empty box: the most recent entries, which is the useful default
  // rather than nothing. Typing narrows with the same 초성 matcher the
  // account picker uses, so 「ㅈㅅ」 finds 「점심」.
  const matchingTitles = suggestions
    .filter((s) => title.trim() === "" || matchesQuery(s.title, title))
    .slice(0, 8);

  /**
   * Fills in what a repeat of this 적요 looked like last time — the two
   * accounts, and nothing else. The amount is the one part that actually
   * differs between repeats, so it is left exactly as typed.
   *
   * Only when there is one leg per side to fill. A suggestion cannot say
   * which of a split's four legs it meant, and half-filling a form is
   * worse than filling none of it.
   */
  function applySuggestion(suggestion: TitleSuggestion) {
    setTitle(suggestion.title);
    setTitleOpen(false);

    const left = lines.filter((l) => l.side === "left");
    const right = lines.filter((l) => l.side === "right");
    if (left.length !== 1 || right.length !== 1) return;

    for (const [line, accountId] of [
      [left[0], suggestion.leftAccountId],
      [right[0], suggestion.rightAccountId],
    ] as const) {
      // Absent when that account has since closed: it is out of the
      // picker, so offering it would put a name in the box that cannot
      // be saved.
      const account = accounts.find((a) => a.id === accountId);
      if (account) void handleAccountSelect(line.key, account);
    }
  }

  const nameOfAccount = (id: string | null) => accounts.find((a) => a.id === id)?.name;

  /**
   * The 적요 box and its suggestions. Both layouts render it, so it is
   * built once here rather than kept in step in two places.
   */
  const titleField = (
    <div className="relative min-w-0">
      <input
        type="text"
        name="title"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          setTitleOpen(true);
        }}
        onFocus={() => setTitleOpen(true)}
        onBlur={() => setTitleOpen(false)}
        autoComplete="off"
        className={controlClass}
      />
      {titleOpen && matchingTitles.length > 0 && (
        <ul className="bg-card rounded-control ring-rule absolute z-20 mt-1 max-h-56 w-max max-w-64 min-w-full overflow-auto shadow-lg ring-1">
          {matchingTitles.map((suggestion) => {
            const from = nameOfAccount(suggestion.leftAccountId);
            const to = nameOfAccount(suggestion.rightAccountId);
            return (
              <li key={suggestion.title}>
                <button
                  type="button"
                  // Pressing must not blur the input first, or the list
                  // closes out from under the finger.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applySuggestion(suggestion)}
                  className="hover:bg-sunken flex min-h-12 w-full flex-col justify-center px-3.5 py-1.5 text-left"
                >
                  <span className="truncate">{suggestion.title}</span>
                  {/* What pressing it will fill in, so it is not a surprise. */}
                  {from && to && (
                    <span className="text-ink-faint truncate text-xs">
                      {from} ← {to}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function handleAccountSelect(key: string, account: EntryFormAccount) {
    updateLine(key, {
      accountId: account.id,
      currency: account.currency,
      rate: null,
    });
    if (account.currency !== baseCurrency) {
      try {
        const res = await fetch(
          `/api/rate?date=${date}&base=${account.currency}&quote=${baseCurrency}`,
        );
        if (res.ok) {
          const data = (await res.json()) as { rate: number };
          updateLine(key, { rate: data.rate });
        }
      } catch {
        // Leave rate null; the user can type it in themselves.
      }
    }
  }

  function setSharedAmount(value: string) {
    setLines((prev) => prev.map((l) => ({ ...l, amountStr: value })));
  }

  function addLine(side: "left" | "right") {
    setSplitForced(true);
    setLines((prev) => [...prev, emptyLine(side)]);
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length > 2 ? prev.filter((l) => l.key !== key) : prev));
  }

  /**
   * Swaps which account sits on which side, leaving the sides themselves
   * (and so the submitted field order) untouched. Only meaningful in the
   * one-line view, where there is exactly one leg per side.
   */
  function swapSides() {
    setLines((prev) => {
      if (prev.length !== 2) return prev;
      const [a, b] = prev;
      const move = (target: Line, source: Line) => ({
        ...target,
        accountId: source.accountId,
        currency: source.currency,
        rate: source.rate,
        memo: source.memo,
      });
      return [move(a, b), move(b, a)];
    });
  }

  function baseAmountOf(line: Line): number | null {
    if (!line.currency || !line.amountStr) return null;
    const amountMinor = toMinorUnits(Number(line.amountStr), line.currency);
    if (!Number.isFinite(amountMinor)) return null;
    const rate = line.currency === baseCurrency ? 1 : line.rate;
    if (rate === null || !Number.isFinite(rate) || rate <= 0) return null;
    return convertMinorUnits(amountMinor, rate, line.currency, baseCurrency);
  }

  const sideTotal = (side: "left" | "right") =>
    lines
      .filter((l) => l.side === side)
      .reduce<number | null>((acc, l) => {
        const v = baseAmountOf(l);
        return acc === null || v === null ? null : acc + v;
      }, 0);

  const leftTotal = sideTotal("left");
  const rightTotal = sideTotal("right");
  const allFilled = lines.every((l) => l.accountId && l.amountStr);
  const isBalanced =
    allFilled && leftTotal !== null && rightTotal !== null && leftTotal === rightTotal;

  const left = lines.find((l) => l.side === "left")!;
  const right = lines.find((l) => l.side === "right")!;

  const money = (minor: number | null) =>
    minor === null ? "—" : formatMoney(minor, baseCurrency, locale);

  /**
   * What the action needs to tell the three cases apart: an id means
   * update in place, the duplicate marker means create and then leave
   * the prefill behind, neither means an ordinary new entry.
   */
  const formIdentityFields = (
    <>
      {initial?.transactionId && (
        <input type="hidden" name="transactionId" value={initial.transactionId} />
      )}
      {isDuplicate && <input type="hidden" name="duplicate" value="1" />}
    </>
  );

  /** Hidden per-line fields. Order matters: the action zips the parallel
   *  getAll() arrays by index, so every line must emit all of its fields
   *  together — which is what lets the split view render by column
   *  instead of in line order. */
  const hiddenLineFields = (line: Line, opts: { rate?: boolean; memo?: boolean } = {}) => (
    <>
      <input type="hidden" name="side" value={line.side} />
      <input type="hidden" name="currency" value={line.currency} />
      {opts.rate !== false && <input type="hidden" name="rate" value={line.rate ?? ""} />}
      {opts.memo !== false && <input type="hidden" name="lineMemo" value={line.memo} />}
    </>
  );

  // Both layouts render it, so it is written once — the simple form is
  // the one this happens on most, and it is the one that had no notice
  // when the first version of this only patched the split view.
  const unconfirmedNotice = saved.unconfirmed ? (
    <p
      role="status"
      data-testid="save-unconfirmed"
      className="bg-negative-soft text-negative rounded-control px-3 py-2 text-sm"
    >
      {labels.unconfirmed}
    </p>
  ) : null;

  if (!showDetailed) {
    return (
      <form action={dispatch} className="space-y-3">
        {formIdentityFields}

        <div className="bg-card rounded-card">
          {/* Date, title and amount share one row from md up; on a phone
              the date takes its own row and the other two split the next.
              One set of fields, not a mobile copy and a desktop copy —
              two inputs with the same name would both be submitted. */}
          <div className="grid grid-cols-2 gap-3 px-4 py-3 md:grid-cols-[10.5rem_1fr_9.5rem]">
            <div className="col-span-2 min-w-0 md:col-span-1">
              <Label>{labels.date}</Label>
              <input
                type="date"
                name="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={`${controlClass} tnum`}
              />
            </div>
            <div className="min-w-0">
              <Label>{labels.title}</Label>
              {titleField}
            </div>
            <div className="min-w-0">
              <Label>{labels.amount}</Label>
              <input
                ref={amountInputRef}
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                aria-label={labels.amount}
                value={left.amountStr}
                onChange={(e) => setSharedAmount(e.target.value)}
                className={`${controlClass} tnum text-right font-semibold`}
              />
            </div>
          </div>

          {/* The pair. Two columns at every width: which side an account
              sits on *is* the entry, so stacking them would erase it. */}
          <div className="border-rule-soft border-t px-4 py-3">
            {/* The swap column is 28px on a phone, not 36: the two account
                boxes split whatever this row leaves them, so every pixel
                the middle takes is half a pixel off each name. */}
            <div className="grid grid-cols-[minmax(0,1fr)_1.75rem_minmax(0,1fr)] items-end gap-1.5 md:grid-cols-[minmax(0,1fr)_2.75rem_minmax(0,1fr)_7rem_7rem] md:gap-3">
              <div className="min-w-0">
                <Label>
                  <span className="text-ink-muted font-semibold">{labels.left}</span> ·{" "}
                  {labels.leftHint}
                </Label>
                <AccountCombobox
                  name="accountId"
                  accounts={accounts}
                  placeholder={labels.namePlaceholder}
                  defaultAccountId={left.accountId}
                  side="left"
                  groupLabels={labels.groups}
                  onSelect={(a) => handleAccountSelect(left.key, a)}
                />
                {hiddenLineFields(left)}
                <input type="hidden" name="amount" value={left.amountStr} />
              </div>

              <button
                type="button"
                onClick={swapSides}
                aria-label={labels.swap}
                className="text-ink-faint hover:text-ink rounded-control grid h-11 w-full place-items-center"
              >
                <SwapIcon />
              </button>

              <div className="min-w-0">
                <Label>
                  <span className="text-ink-muted font-semibold">{labels.right}</span> ·{" "}
                  {labels.rightHint}
                </Label>
                <AccountCombobox
                  name="accountId"
                  accounts={accounts}
                  placeholder={labels.namePlaceholder}
                  defaultAccountId={right.accountId}
                  side="right"
                  groupLabels={labels.groups}
                  onSelect={(a) => handleAccountSelect(right.key, a)}
                />
                {hiddenLineFields(right)}
                <input type="hidden" name="amount" value={right.amountStr} />
              </div>

              {/* One pair of buttons, not two: `md:contents` promotes them
                  into the pair grid at desktop instead of rendering a
                  second copy that would duplicate their accessible names. */}
              <div className="col-span-3 mt-2 grid grid-cols-[6.5rem_1fr] gap-2.5 md:contents">
                <button
                  type="button"
                  onClick={() => setSplitForced(true)}
                  className={buttonClass("secondary", true)}
                >
                  {labels.split}
                </button>
                <SubmitButton
                  variant="primary"
                  full
                  disabled={!isBalanced || (isEditing && !isDirty)}
                  pendingLabel={labels.saving}
                >
                  {labels.save}
                </SubmitButton>
              </div>
              <div className="col-span-3">{unconfirmedNotice}</div>
            </div>
          </div>

          <details className="border-rule-soft border-t">
            <summary className="text-ink-muted flex min-h-11 cursor-pointer items-center px-4 text-sm">
              {labels.memo}
            </summary>
            <div className="px-4 pb-3">
              <input
                type="text"
                name="memo"
                aria-label={labels.memo}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                className={controlClass}
              />
            </div>
          </details>
        </div>
      </form>
    );
  }

  const columns: { side: "left" | "right"; label: string; hint: string }[] = [
    { side: "left", label: labels.left, hint: labels.leftHint },
    { side: "right", label: labels.right, hint: labels.rightHint },
  ];

  return (
    <form action={dispatch} className="space-y-3">
      {formIdentityFields}

      <div className="bg-card rounded-card overflow-hidden">
        <div className="grid grid-cols-2 gap-3 px-4 py-3 md:grid-cols-[10.5rem_1fr_1fr]">
          <div className="min-w-0">
            <Label>{labels.date}</Label>
            <input
              type="date"
              name="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`${controlClass} tnum`}
            />
          </div>
          <div className="min-w-0">
            <Label>{labels.title}</Label>
            {titleField}
          </div>
          <div className="col-span-2 min-w-0 md:col-span-1">
            <Label>{labels.memo}</Label>
            <input
              type="text"
              name="memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className={controlClass}
            />
          </div>
        </div>

        {/* T-account: left legs in the left column, right legs in the
            right one, same as the one-line view. The short column keeps a
            dashed slot that stretches to the height difference, so an
            unbalanced line count is visible as a gap rather than as a
            misaligned list. */}
        <div className="border-rule-soft grid grid-cols-2 border-t">
          {columns.map((column) => {
            const columnLines = lines.filter((l) => l.side === column.side);
            return (
              <div
                key={column.side}
                data-testid={`entry-column-${column.side}`}
                className="not-first:border-rule-soft flex min-w-0 flex-col not-first:border-l"
              >
                <div className="border-rule-soft bg-sunken text-ink-faint truncate border-b px-2.5 py-2 text-xs md:px-4">
                  <span className="text-ink-muted font-bold">{column.label}</span> · {column.hint}
                </div>

                {columnLines.map((line) => (
                  <div
                    key={line.key}
                    data-testid="entry-leg"
                    className="not-first:border-rule-soft grid gap-1.5 p-2.5 not-first:border-t md:grid-cols-[minmax(0,1fr)_7rem_7rem] md:items-start md:gap-2 md:p-3"
                  >
                    <AccountCombobox
                      name="accountId"
                      accounts={accounts}
                      placeholder={labels.namePlaceholder}
                      defaultAccountId={line.accountId}
                      side={line.side}
                      groupLabels={labels.groups}
                      onSelect={(a) => handleAccountSelect(line.key, a)}
                    />
                    {hiddenLineFields(line, { rate: false, memo: false })}

                    <div className="grid gap-1.5">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        inputMode="decimal"
                        name="amount"
                        aria-label={labels.amount}
                        value={line.amountStr}
                        onChange={(e) => updateLine(line.key, { amountStr: e.target.value })}
                        placeholder={labels.amount}
                        className={`${controlClass} tnum text-right font-semibold`}
                      />
                      {line.currency && line.currency !== baseCurrency ? (
                        <input
                          type="number"
                          step="any"
                          min="0"
                          name="rate"
                          aria-label={labels.rate}
                          value={line.rate ?? ""}
                          onChange={(e) =>
                            updateLine(line.key, {
                              rate: e.target.value === "" ? null : Number(e.target.value),
                            })
                          }
                          placeholder={labels.rate}
                          className={`${controlClass} tnum text-right`}
                        />
                      ) : (
                        <input type="hidden" name="rate" value="" />
                      )}
                    </div>

                    <input
                      type="text"
                      name="lineMemo"
                      aria-label={labels.details}
                      value={line.memo}
                      onChange={(e) => updateLine(line.key, { memo: e.target.value })}
                      placeholder={labels.details}
                      className={`${controlClass} text-sm`}
                    />

                    {lines.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        className="text-negative min-h-11 text-xs md:col-span-3 md:justify-self-end"
                      >
                        {labels.removeLine}
                      </button>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => addLine(column.side)}
                  className="border-rule text-ink-faint hover:text-ink rounded-control m-2.5 flex min-h-16 flex-1 items-center justify-center border-2 border-dashed text-xs"
                >
                  + {labels.addLine}
                </button>
              </div>
            );
          })}
        </div>

        <div
          className={`border-rule-soft flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-4 py-2.5 text-sm font-semibold ${
            isBalanced ? "bg-positive-soft text-positive" : "bg-negative-soft text-negative"
          }`}
        >
          <span className="tnum">{money(leftTotal)}</span>
          <span aria-hidden="true">{isBalanced ? "=" : "≠"}</span>
          <span className="tnum">{money(rightTotal)}</span>
          <span>· {isBalanced ? labels.balanced : labels.unbalanced}</span>
          {!isBalanced && leftTotal !== null && rightTotal !== null && (
            <span className="tnum font-normal">
              {labels.difference} {money(Math.abs(leftTotal - rightTotal))}
            </span>
          )}
        </div>
      </div>

      {unconfirmedNotice}

      <SubmitButton
        variant="primary"
        full
        disabled={!isBalanced || (isEditing && !isDirty)}
        pendingLabel={labels.saving}
      >
        {labels.save}
      </SubmitButton>
    </form>
  );
}
