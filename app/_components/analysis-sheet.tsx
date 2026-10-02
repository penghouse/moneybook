"use client";

import { useRef, useState } from "react";
import { QUESTION_LIMIT } from "@/lib/analysis-brief";
import { SubmitButton } from "./submit-button";
import { buttonClass, controlClass } from "./ui";

export interface ProposedBudget {
  accountId: string;
  account: string;
  /** Formatted; null where nothing was budgeted. */
  current: string | null;
  next: string;
  amountMajor: number;
  why: string;
}

export interface AnalysisLabels {
  open: string;
  title: string;
  close: string;
  reading: string;
  sent: string;
  sentCount: string;
  followUp: string;
  send: string;
  retry: string;
  disclaimer: string;
  failed: string;
  notConfigured: string;
  read: string;
  plan: string;
  planNone: string;
  apply: string;
  applying: string;
  applied: string;
}

/**
 * 「분석」 — the screen asks Claude about its own figures.
 *
 * One press, no question box in the way. The screen knows what it is
 * for, so it carries its own default question and runs it the moment
 * the sheet opens; the box underneath is for the second question, which
 * is the one nobody can write in advance.
 *
 * `brief` is the exact text that is sent, and the same string is what
 * 「보낸 내용」 shows. Rendering it twice would mean the panel describes
 * the request rather than being it, and this is the one place in the app
 * where data leaves the device.
 */
export function AnalysisSheet({
  brief,
  defaultQuestion,
  labels,
  period,
  applyAction,
}: {
  brief: string;
  defaultQuestion: string;
  labels: AnalysisLabels;
  /** 'YYYY-MM' on the budget screen, which is the one that can act. */
  period?: string;
  applyAction?: (formData: FormData) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [asked, setAsked] = useState(defaultQuestion);
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<"idle" | "reading" | "done" | "failed" | "unconfigured">(
    "idle",
  );
  const [followUp, setFollowUp] = useState("");
  /** What the model fetched, in the order it asked. */
  const [reads, setReads] = useState<string[]>([]);
  const [plan, setPlan] = useState<ProposedBudget[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);

  const run = async (question: string) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    setAsked(question);
    setAnswer("");
    setReads([]);
    setPlan([]);
    setPicked([]);
    setApplied(false);
    setState("reading");
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief, question, period }),
        signal: controller.signal,
      });
      if (response.status === 503) {
        setState("unconfigured");
        return;
      }
      if (!response.ok || !response.body) {
        setState("failed");
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      // Newline-delimited JSON, so a chunk can end mid-line: whatever is
      // past the last newline waits for the next read rather than being
      // parsed as a truncated object.
      let pending = "";
      let failed = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as { t: string; v: unknown };
            if (event.t === "text") setAnswer((prev) => prev + String(event.v));
            else if (event.t === "read") setReads((prev) => [...prev, String(event.v)]);
            else if (event.t === "plan") {
              const rows = event.v as ProposedBudget[];
              setPlan(rows);
              // Ticked already: 적용 is the door that asks, and a second
              // door in front of it only means everyone ticks all and
              // presses anyway.
              setPicked(rows.map((r) => r.accountId));
            } else if (event.t === "error") failed = true;
          } catch {
            // A line this side cannot read is one event lost, not a
            // reason to drop the answer already on screen.
          }
        }
      }
      setState(failed ? "failed" : "done");
    } catch (error) {
      // An abort is the reader closing the sheet or asking again, not a
      // failure to report.
      if ((error as Error)?.name !== "AbortError") setState("failed");
    }
  };

  const open = () => {
    dialog.current?.showModal();
    if (state === "idle") void run(defaultQuestion);
  };

  const close = () => {
    abort.current?.abort();
    dialog.current?.close();
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        data-testid="analysis-open"
        className={buttonClass("secondary")}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="text-accent"
        >
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
          <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
        </svg>
        {labels.open}
      </button>

      <dialog
        ref={dialog}
        aria-label={labels.title}
        onClick={(e) => {
          if (e.target === dialog.current) close();
        }}
        onClose={() => abort.current?.abort()}
        className="bg-card rounded-card text-ink m-auto w-[min(34rem,calc(100vw-1.5rem))] p-0 backdrop:bg-black/50"
      >
        <div className="border-rule-soft flex min-h-12 items-center gap-2 border-b px-4">
          <h2 className="min-w-0 flex-1 truncate font-semibold">{labels.title}</h2>
          <button
            type="button"
            onClick={close}
            aria-label={labels.close}
            className="text-ink-faint hover:text-ink -mr-2 grid h-11 w-11 shrink-0 place-items-center text-xl"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[70vh] space-y-3 overflow-auto px-4 py-4">
          <p className="text-ink-muted text-sm">{asked}</p>

          {state === "reading" && answer === "" && (
            <div className="text-ink-muted flex items-center gap-2 text-sm">
              <span
                aria-hidden="true"
                className="border-rule border-t-accent inline-block size-4 animate-spin rounded-full border-2"
              />
              {labels.reading}
            </div>
          )}

          {answer && (
            <p
              data-testid="analysis-answer"
              className="text-sm leading-relaxed whitespace-pre-wrap"
            >
              {answer}
            </p>
          )}

          {state === "unconfigured" && (
            <p className="text-ink-muted text-sm">{labels.notConfigured}</p>
          )}
          {state === "failed" && (
            <div className="space-y-2">
              <p className="text-negative text-sm">{labels.failed}</p>
              <button
                type="button"
                onClick={() => void run(asked)}
                className={buttonClass("secondary")}
              >
                {labels.retry}
              </button>
            </div>
          )}

          {plan.length > 0 && applyAction && period && (
            <form
              action={async (formData) => {
                await applyAction(formData);
                setApplied(true);
              }}
              data-testid="analysis-plan"
              className="border-rule-soft rounded-control space-y-2 border p-3"
            >
              <p className="text-sm font-semibold">{labels.plan}</p>
              <input type="hidden" name="period" value={period} />
              {plan.map((row) => {
                const on = picked.includes(row.accountId);
                return (
                  <label
                    key={row.accountId}
                    className="flex items-start gap-2 text-sm"
                    data-testid="analysis-plan-row"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) =>
                        setPicked((prev) =>
                          e.target.checked
                            ? [...prev, row.accountId]
                            : prev.filter((id) => id !== row.accountId),
                        )
                      }
                      className="accent-accent mt-0.5 size-5 shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold">{row.account}</span>
                        <span className="tnum text-ink-muted">
                          {row.current ?? labels.planNone} → <strong>{row.next}</strong>
                        </span>
                      </span>
                      <span className="text-ink-muted block text-xs">{row.why}</span>
                    </span>
                    {on && (
                      <>
                        <input type="hidden" name="accountId" value={row.accountId} />
                        <input type="hidden" name="amountMajor" value={row.amountMajor} />
                        <input type="hidden" name="why" value={row.why} />
                      </>
                    )}
                  </label>
                );
              })}
              {applied ? (
                <p className="text-positive text-sm font-semibold">{labels.applied}</p>
              ) : (
                <SubmitButton variant="primary" pendingLabel={labels.applying}>
                  {labels.apply}
                </SubmitButton>
              )}
            </form>
          )}

          {/* Open on demand, but it is the request itself — the same
              string the fetch body carries. This is the one screen that
              sends the book's figures off the device, so what went is
              not something the reader should have to take on trust. */}
          <details className="border-rule-soft border-t pt-2">
            <summary className="text-ink-muted min-h-11 cursor-pointer text-xs">
              {labels.sentCount.replace("{n}", String(brief.split("\n").length))}
            </summary>
            <pre
              data-testid="analysis-brief"
              className="bg-sunken text-ink-muted mt-1 overflow-auto rounded-lg p-3 text-[11px] leading-relaxed"
            >
              {brief}
            </pre>
            {/* Detail is fetched, not volunteered — so the panel says
                what was fetched as well as what was sent. */}
            {reads.length > 0 && (
              <ul
                data-testid="analysis-reads"
                className="text-ink-muted mt-2 space-y-1 text-[11px]"
              >
                {reads.map((read, i) => (
                  <li key={i}>
                    {labels.read} {read}
                  </li>
                ))}
              </ul>
            )}
          </details>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const question = followUp.trim();
              if (!question) return;
              setFollowUp("");
              void run(question);
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              maxLength={QUESTION_LIMIT}
              aria-label={labels.followUp}
              placeholder={labels.followUp}
              data-testid="analysis-followup"
              className={`${controlClass} min-w-0 flex-1`}
            />
            <button
              type="submit"
              disabled={state === "reading" || followUp.trim() === ""}
              className={buttonClass("primary")}
            >
              {labels.send}
            </button>
          </form>

          <p className="text-ink-muted text-xs leading-relaxed">{labels.disclaimer}</p>
        </div>
      </dialog>
    </>
  );
}
