import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { exchangeRates, transactions } from "@/db/schema";
import { getTranslations, type TranslationKey } from "@/i18n";
import { today } from "@/lib/date";
import { getOrCreateSection } from "@/lib/current-section";
import { requireUserId } from "@/lib/current-user";
import { parseFavorites } from "@/lib/nav-favorites";
import { CURRENCY_OPTIONS, TIMEZONE_OPTIONS } from "@/lib/options";
import { NAV_ITEMS } from "../_components/nav-items";
import { SubmitButton } from "../_components/submit-button";
import {
  Card,
  controlClass,
  EmptyState,
  Hint,
  KeyValueRow,
  Label,
  PageHeader,
  SectionLabel,
} from "../_components/ui";
import {
  setManualRateAction,
  updateNavFavoritesAction,
  updateSectionSettingsAction,
} from "./actions";
import {
  importAccountsAction,
  importBudgetsAction,
  importRatesAction,
  importTransactionsAction,
  importPairedAction,
} from "./csv-actions";
import { CsvImportForm, type CsvImportLabels } from "./csv-import";

const RATE_SOURCE_KEY: Record<"api" | "manual", TranslationKey> = {
  api: "settings.rateSourceApi",
  manual: "settings.rateSourceManual",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const userId = await requireUserId();
  const { t, locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });
  const { saved, error } = await searchParams;
  const favorites = parseFavorites(section.navFavorites);

  const hasTransactions = !!(await db.query.transactions.findFirst({
    where: eq(transactions.sectionId, section.id),
  }));

  const recentRates = await db.query.exchangeRates.findMany({
    where: eq(exchangeRates.quote, section.baseCurrency),
    orderBy: desc(exchangeRates.date),
    limit: 10,
  });

  const csvLabels: CsvImportLabels = {
    preview: t("csv.preview"),
    confirm: t("csv.confirm"),
    sizeHint: t("csv.sizeHint"),
    selectedFile: t("csv.selectedFile"),
  };

  const exports = [
    {
      href: "/api/csv/accounts",
      label: t("csv.exportAccounts"),
      kind: "accounts",
    },
    {
      href: "/api/csv/transactions",
      label: t("csv.exportTransactions"),
      kind: "transactions",
    },
    {
      href: "/api/csv/budgets",
      label: t("csv.exportBudgets"),
      kind: "budgets",
    },
    { href: "/api/csv/rates", label: t("csv.exportRates"), kind: "rates" },
  ];

  const imports = [
    {
      action: importAccountsAction,
      label: t("csv.importAccounts"),
      kind: "accounts",
    },
    {
      action: importTransactionsAction,
      label: t("csv.importTransactions"),
      kind: "transactions",
    },
    {
      action: importBudgetsAction,
      label: t("csv.importBudgets"),
      kind: "budgets",
    },
    { action: importRatesAction, label: t("csv.importRates"), kind: "rates" },
    // Last, and the only one with its own hint: this reads another app's
    // export rather than one of ours, so what it will do with the file
    // (create accounts, flip negative rows) has to be said up front.
    {
      action: importPairedAction,
      label: t("csv.importPaired"),
      kind: "paired",
      hint: t("csv.pairedHint"),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t("nav.settings")} />

      {saved === "1" && (
        <p className="bg-positive-soft text-positive rounded-control px-3 py-2 text-sm">
          {t("settings.saved")}
        </p>
      )}
      {error === "base_currency_locked" && (
        <p className="bg-negative-soft text-negative rounded-control px-3 py-2 text-sm">
          {t("settings.baseCurrencyLocked")}
        </p>
      )}

      <Card>
        <form action={updateSectionSettingsAction} className="grid gap-3 px-4 py-4 md:grid-cols-2">
          <div className="min-w-0 md:col-span-2">
            <Label>{t("settings.sectionName")}</Label>
            <input type="text" name="name" defaultValue={section.name} className={controlClass} />
          </div>

          <div className="min-w-0">
            <Label>{t("settings.baseCurrency")}</Label>
            <select
              name="baseCurrency"
              defaultValue={section.baseCurrency}
              disabled={hasTransactions}
              className={`${controlClass} disabled:opacity-50`}
            >
              {CURRENCY_OPTIONS.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <Label>{t("settings.timezone")}</Label>
            <select name="timezone" defaultValue={section.timezone} className={controlClass}>
              {TIMEZONE_OPTIONS.map((timezone) => (
                <option key={timezone} value={timezone}>
                  {timezone}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <Hint>{t("settings.timezoneHint")}</Hint>
          </div>

          <SubmitButton
            variant="primary"
            full
            className="md:col-span-2"
            pendingLabel={t("common.saving")}
          >
            {t("common.save")}
          </SubmitButton>
        </form>
      </Card>

      <section>
        <SectionLabel>{t("settings.navFavorites")}</SectionLabel>
        <Card>
          <form action={updateNavFavoritesAction} className="px-4 py-3">
            <ul className="mb-2">
              {NAV_ITEMS.map((item) => (
                <li key={item.href} className="not-first:border-rule-soft not-first:border-t">
                  {/* data-control: the checkbox is 20px, but the whole
                      48px row is what a finger lands on — the mobile
                      touch-target test measures the marked box. */}
                  <label data-control className="flex min-h-12 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      name="href"
                      value={item.href}
                      defaultChecked={favorites.includes(item.href)}
                      className="accent-accent size-5"
                    />
                    <span>{t(item.labelKey)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <Hint>{t("settings.navFavoritesHint")}</Hint>
            <SubmitButton variant="primary" full className="mt-3" pendingLabel={t("common.saving")}>
              {t("common.save")}
            </SubmitButton>
          </form>
        </Card>
      </section>

      <section>
        <SectionLabel>{t("settings.exchangeRates")}</SectionLabel>
        <Card>
          <form
            action={setManualRateAction}
            className="grid grid-cols-2 gap-3 px-4 py-3 md:grid-cols-4 md:items-end"
          >
            <div className="min-w-0">
              <Label>{t("common.date")}</Label>
              <input
                type="date"
                name="date"
                defaultValue={today(section.timezone)}
                className={`${controlClass} tnum`}
              />
            </div>
            <div className="min-w-0">
              <Label>{t("common.currency")}</Label>
              <select
                name="base"
                defaultValue={CURRENCY_OPTIONS.find((c) => c !== section.baseCurrency)}
                className={controlClass}
              >
                {CURRENCY_OPTIONS.filter((c) => c !== section.baseCurrency).map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <Label>
                {t("settings.rate")} (→ {section.baseCurrency})
              </Label>
              <input
                type="number"
                name="rate"
                step="any"
                min="0"
                inputMode="decimal"
                required
                className={`${controlClass} tnum text-right`}
              />
            </div>
            <SubmitButton
              variant="primary"
              full
              className="self-end"
              pendingLabel={t("common.saving")}
            >
              {t("common.save")}
            </SubmitButton>
          </form>
        </Card>

        <p className="text-ink-faint mt-3 mb-1.5 px-1 text-xs">{t("settings.recentRates")}</p>
        <Card>
          {recentRates.length === 0 ? (
            <EmptyState>{t("settings.noRates")}</EmptyState>
          ) : (
            recentRates.map((r) => (
              <KeyValueRow
                key={`${r.date}-${r.base}-${r.quote}`}
                label={
                  <span className="tnum text-sm">
                    {r.date} · 1 {r.base} = {r.rate} {r.quote}
                  </span>
                }
                value={
                  <span className="text-ink-faint text-xs">{t(RATE_SOURCE_KEY[r.source])}</span>
                }
              />
            ))
          )}
        </Card>
      </section>

      <section>
        <SectionLabel>{t("settings.csvSection")}</SectionLabel>
        {/* Eight forms in a row made this page endless on a phone, so each
            one collapses to a single 44px row until it is opened. */}
        <Card>
          {exports.map((e) => (
            <a
              key={e.href}
              href={e.href}
              data-testid={`csv-export-${e.kind}`}
              className="not-first:border-rule-soft hover:bg-sunken flex min-h-12 items-center px-4 text-sm not-first:border-t"
            >
              {e.label}
            </a>
          ))}
        </Card>

        <div className="mt-3">
          <Card>
            {imports.map((i) => (
              <details
                key={i.kind}
                data-testid={`csv-import-${i.kind}`}
                className="not-first:border-rule-soft not-first:border-t"
              >
                <summary className="flex min-h-12 cursor-pointer items-center px-4 text-sm">
                  {i.label}
                </summary>
                <div className="border-rule-soft border-t px-4 py-3">
                  <CsvImportForm
                    action={i.action}
                    labels={{ ...csvLabels, sizeHint: i.hint ?? csvLabels.sizeHint }}
                  />
                </div>
              </details>
            ))}
          </Card>
        </div>
      </section>
    </div>
  );
}
