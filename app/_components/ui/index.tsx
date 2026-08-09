import type { ReactNode } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/money";

/**
 * The shared vocabulary every screen is built from. Before this, each
 * page repeated strings like
 * `rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:...`
 * by hand, which is why spacing, radius and colour drifted apart from
 * screen to screen. Anything visual belongs here, not in a page.
 */

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      {children}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    // No border. A card is distinguished from the page by being lighter
    // than the ground it sits on — in both themes — and a hairline on top
    // of that only adds noise. Hairlines survive *inside* a card, between
    // rows, because a list does need them to be read.
    <div className={`bg-card rounded-card overflow-hidden ${className}`}>{children}</div>
  );
}

/** A padded band inside a Card. Consecutive rows get a hairline between them. */
export function Row({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`not-first:border-rule-soft px-4 py-3 not-first:border-t ${className}`}>
      {children}
    </div>
  );
}

/** A list's heading, not a caption. It used to be 12px in the faintest
 *  grey, which put it visually below the rows it introduces. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="text-ink mt-6 mb-2 px-1 text-sm font-semibold">{children}</h2>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-ink-faint px-4 py-6 text-center text-sm">{children}</p>;
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="text-ink-faint mb-1.5 block text-xs font-medium">
      {children}
    </label>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-ink-faint mt-1.5 text-xs">{children}</p>;
}

/**
 * Shared control chrome, so inputs and selects can't drift apart.
 *
 * `min-w-0` is load-bearing: an <input> carries an intrinsic default
 * width (roughly `size` characters, ~268px at 16px), and as a flex or
 * grid item its automatic minimum size is that intrinsic width — so
 * `w-full` alone does not stop it from forcing its track wider than the
 * container. That is what pushed the split view's right column outside
 * the card.
 */
export const controlClass =
  "bg-sunken text-ink rounded-control min-h-12 w-full min-w-0 px-3.5 " +
  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const buttonVariant: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink border-accent font-semibold",
  secondary: "bg-sunken text-ink border-transparent hover:bg-rule",
  danger: "bg-card text-negative border-negative/40 hover:bg-negative-soft",
  ghost: "bg-transparent text-ink-muted border-transparent hover:bg-sunken",
};

/**
 * Every target is at least 48px tall, and the primary action is 52 —
 * comfortably past the 44px floor rather than sitting exactly on it.
 * Nothing in the pre-redesign UI reached even 44: most controls were
 * 26–34px and the nav links were bare text with no padding at all.
 */
export function buttonClass(variant: ButtonVariant = "secondary", full = false) {
  return [
    "inline-flex items-center justify-center gap-1.5 rounded-control border",
    variant === "primary" ? "min-h-13" : "min-h-12",
    // A disabled button used to be the same button at 40% opacity, which
    // on this page put three shades of grey next to each other — an
    // active `secondary`, a disabled `secondary`, and the sunken surface
    // behind them. Unavailable now reads as *unfilled* rather than as
    // faint, so it cannot be mistaken for a button that simply looks dim.
    "px-4 text-sm disabled:cursor-not-allowed",
    "disabled:border-rule-soft disabled:bg-transparent disabled:text-ink-faint",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    buttonVariant[variant],
    full ? "w-full" : "",
  ].join(" ");
}

export type MoneyTone = "default" | "signed" | "muted";

/**
 * Money is read down a column, so it is always tabular and right-aligned.
 * `signed` colours by sign for figures where direction is the point
 * (unrealized FX, net income); plain balances stay neutral, because
 * colouring every number turns the page into noise.
 */
export function Money({
  amount,
  currency,
  locale,
  tone = "default",
  showPlus = false,
  className = "",
}: {
  amount: number;
  currency: string;
  locale: string;
  tone?: MoneyTone;
  showPlus?: boolean;
  className?: string;
}) {
  const toneClass =
    tone === "muted"
      ? "text-ink-faint"
      : tone === "signed"
        ? amount > 0
          ? "text-positive"
          : amount < 0
            ? "text-negative"
            : ""
        : "";

  return (
    <span className={`tnum text-right font-semibold ${toneClass} ${className}`}>
      {showPlus && amount > 0 ? "+" : ""}
      {formatMoney(amount, currency, locale)}
    </span>
  );
}

/**
 * Label on the left, value on the right — the pattern that previously
 * used a bare `flex justify-between` and broke on narrow screens,
 * because an Intl currency string has no wrap opportunity and neither
 * side could shrink. Wrapping is allowed here and `sub` gets its own
 * full-width line with real vertical spacing.
 */
export function KeyValueRow({
  label,
  value,
  sub,
  className = "",
  href,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
  /** Makes the whole row the link, rather than just the label — a name
   *  on its own is a 24px target on a page meant to be read with a thumb. */
  href?: string;
}) {
  const shared = `not-first:border-rule-soft flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 not-first:border-t ${className}`;
  const content = (
    <>
      <span className="min-w-0 break-keep">{label}</span>
      <span className="ml-auto">{value}</span>
      {sub && <div className="flex w-full flex-wrap gap-x-2 gap-y-1.5 pt-0.5">{sub}</div>}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`${shared} hover:bg-sunken min-h-12`}>
        {content}
      </Link>
    );
  }
  return <div className={shared}>{content}</div>;
}

export type ChipTone = "default" | "positive" | "negative" | "warning";

const chipTone: Record<ChipTone, string> = {
  default: "border-transparent bg-sunken text-ink-muted",
  positive: "border-transparent bg-positive-soft text-positive",
  negative: "border-transparent bg-negative-soft text-negative",
  warning: "border-transparent bg-sunken text-warning",
};

export function Chip({ children, tone = "default" }: { children: ReactNode; tone?: ChipTone }) {
  return (
    <span className={`tnum rounded-full border px-2 py-0.5 text-xs ${chipTone[tone]}`}>
      {children}
    </span>
  );
}
