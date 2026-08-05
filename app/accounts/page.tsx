import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db/client";
import { accounts, ACCOUNT_GROUPS, type Account, type AccountGroup } from "@/db/schema";
import { getTranslations, type TranslationKey } from "@/i18n";
import { isClosedBy } from "@/lib/accounts";
import { getOrCreateSection } from "@/lib/current-section";
import { requireUserId } from "@/lib/current-user";
import { today } from "@/lib/date";
import { CURRENCY_OPTIONS } from "@/lib/options";
import {
  buttonClass,
  Card,
  Chip,
  controlClass,
  EmptyState,
  Hint,
  Label,
  PageHeader,
  SectionLabel,
} from "../_components/ui";
import {
  createAccountAction,
  deleteAccountAction,
  moveAccountAction,
  toggleArchiveAction,
  updateAccountAction,
} from "./actions";

const GROUP_LABEL_KEY: Record<AccountGroup, TranslationKey> = {
  asset: "group.asset",
  liability: "group.liability",
  equity: "group.equity",
  expense: "group.expense",
  income: "group.income",
};

const ERROR_KEY: Record<string, TranslationKey> = {
  delete_restricted: "accounts.deleteError",
  active_range: "accounts.activeRangeError",
};

/** "2024-03-15까지" / "2024-03-15~" / "2023-01-01~2024-03-15" — null ends read as open. */
function windowLabel(account: Account): string | null {
  if (account.activeFrom === null && account.activeTo === null) return null;
  if (account.activeFrom === null) return `~${account.activeTo}`;
  if (account.activeTo === null) return `${account.activeFrom}~`;
  return `${account.activeFrom}~${account.activeTo}`;
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; showArchived?: string }>;
}) {
  const userId = await requireUserId();
  const { t, locale } = await getTranslations();
  const section = await getOrCreateSection(db, { userId, locale });
  const { error, showArchived } = await searchParams;
  const asOf = today(section.timezone);

  const allAccounts = await db.query.accounts.findMany({
    where: eq(accounts.sectionId, section.id),
    orderBy: asc(accounts.sortOrder),
  });

  const byGroup = new Map<AccountGroup, Account[]>();
  for (const group of ACCOUNT_GROUPS) byGroup.set(group, []);
  for (const account of allAccounts) {
    // An account whose window has not opened yet stays listed — it was
    // set up deliberately and hiding it would look like the save failed.
    // Only a closed one folds away behind the toggle.
    if (isClosedBy(account, asOf) && showArchived !== "1") continue;
    byGroup.get(account.group)!.push(account);
  }

  // Suggestions for the category field. Free text is what makes a typo
  // able to split "먹는 것" in two, and offering what already exists is
  // the cheapest thing that stops it.
  const knownCategories = [
    ...new Set(allAccounts.map((a) => a.category).filter((c): c is string => !!c)),
  ].sort();
  const categoryListId = "account-categories";

  /** Accounts under their category heading, unfiled ones last. */
  function byCategory(list: Account[]) {
    const map = new Map<string | null, Account[]>();
    for (const account of list) {
      const key = account.category ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(account);
    }
    return [...map.entries()]
      .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : 0))
      .map(([category, accounts]) => ({ category, accounts }));
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t("nav.accounts")} />

      {error && ERROR_KEY[error] && (
        <p className="bg-negative-soft text-negative rounded-control px-3 py-2 text-sm">
          {t(ERROR_KEY[error])}
        </p>
      )}

      <Card>
        <h2 className="text-ink-faint px-4 pt-3 text-xs font-semibold">
          {t("accounts.newAccount")}
        </h2>
        <form
          action={createAccountAction}
          className="grid gap-3 px-4 py-3 md:grid-cols-[8rem_1fr_1fr_6rem_auto] md:items-end"
        >
          <div className="min-w-0">
            <Label>{t("accounts.group")}</Label>
            <select name="group" defaultValue="expense" className={controlClass}>
              {ACCOUNT_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {t(GROUP_LABEL_KEY[group])}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <Label>{t("common.name")}</Label>
            <input
              type="text"
              name="name"
              required
              placeholder={t("accounts.namePlaceholder")}
              className={controlClass}
            />
          </div>
          <div className="min-w-0">
            <Label>{t("accounts.category")}</Label>
            <input
              type="text"
              name="category"
              list={categoryListId}
              placeholder={t("accounts.categoryPlaceholder")}
              className={controlClass}
            />
          </div>
          <div className="min-w-0">
            <Label>{t("common.currency")}</Label>
            <select name="currency" defaultValue={section.baseCurrency} className={controlClass}>
              {CURRENCY_OPTIONS.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={buttonClass("primary", true)}>
            {t("common.add")}
          </button>
        </form>
      </Card>

      {/* One list for every category field on the page. */}
      <datalist id={categoryListId}>
        {knownCategories.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>

      {ACCOUNT_GROUPS.map((group) => {
        const list = byGroup.get(group) ?? [];
        return (
          <section key={group}>
            <SectionLabel>{t(GROUP_LABEL_KEY[group])}</SectionLabel>
            <Card>
              {list.length === 0 ? (
                <EmptyState>{t("accounts.empty")}</EmptyState>
              ) : (
                byCategory(list).map(({ category, accounts: inCategory }) => (
                  <div key={category ?? "\u0000uncategorized"}>
                    {/* Only worth a heading once something is filed —
                        a lone "미분류" band over every account is noise. */}
                    {knownCategories.length > 0 && (
                      <h3 className="bg-sunken text-ink-muted border-rule-soft border-t px-4 py-1.5 text-xs font-semibold first:border-t-0">
                        {category ?? t("accounts.uncategorized")}
                      </h3>
                    )}
                    <ul>
                      {inCategory.map((account) => {
                        // Index within the whole group, not the category:
                        // sortOrder is group-wide and that is what the
                        // move buttons swap.
                        const i = list.indexOf(account);
                        return (
                          <li
                            key={account.id}
                            className="not-first:border-rule-soft not-first:border-t"
                          >
                            <details>
                              <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 py-2">
                                <span className="min-w-0 truncate">{account.name}</span>
                                {windowLabel(account) && (
                                  <Chip>
                                    <span className="tnum">{windowLabel(account)}</span>
                                  </Chip>
                                )}
                                <span className="text-ink-faint ml-auto shrink-0 text-xs">
                                  {account.currency}
                                </span>
                              </summary>

                              <div className="border-rule-soft space-y-3 border-t px-4 py-3">
                                <form
                                  action={updateAccountAction}
                                  className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end lg:grid-cols-[1fr_1fr_1fr_9rem_9rem_auto]"
                                >
                                  <input type="hidden" name="accountId" value={account.id} />
                                  <div className="min-w-0">
                                    <Label>{t("common.name")}</Label>
                                    <input
                                      type="text"
                                      name="name"
                                      defaultValue={account.name}
                                      className={controlClass}
                                    />
                                  </div>
                                  <div className="min-w-0">
                                    <Label>{t("accounts.category")}</Label>
                                    <input
                                      type="text"
                                      name="category"
                                      list={categoryListId}
                                      defaultValue={account.category ?? ""}
                                      placeholder={t("accounts.categoryPlaceholder")}
                                      className={controlClass}
                                    />
                                  </div>
                                  <div className="min-w-0">
                                    <Label>{t("common.memo")}</Label>
                                    <input
                                      type="text"
                                      name="memo"
                                      defaultValue={account.memo ?? ""}
                                      placeholder={t("common.memo")}
                                      className={controlClass}
                                    />
                                  </div>
                                  <div className="min-w-0">
                                    <Label>{t("accounts.activeFrom")}</Label>
                                    <input
                                      type="date"
                                      name="activeFrom"
                                      defaultValue={account.activeFrom ?? ""}
                                      className={`${controlClass} tnum`}
                                    />
                                  </div>
                                  <div className="min-w-0">
                                    <Label>{t("accounts.activeTo")}</Label>
                                    <input
                                      type="date"
                                      name="activeTo"
                                      defaultValue={account.activeTo ?? ""}
                                      className={`${controlClass} tnum`}
                                    />
                                  </div>
                                  <button type="submit" className={buttonClass("secondary")}>
                                    {t("common.save")}
                                  </button>
                                </form>
                                <Hint>{t("accounts.activeHint")}</Hint>

                                <div className="flex flex-wrap gap-2">
                                  <form action={moveAccountAction}>
                                    <input type="hidden" name="accountId" value={account.id} />
                                    <input type="hidden" name="direction" value="up" />
                                    <button
                                      type="submit"
                                      disabled={i === 0}
                                      className={buttonClass("secondary")}
                                    >
                                      {t("common.moveUp")}
                                    </button>
                                  </form>
                                  <form action={moveAccountAction}>
                                    <input type="hidden" name="accountId" value={account.id} />
                                    <input type="hidden" name="direction" value="down" />
                                    <button
                                      type="submit"
                                      disabled={i === list.length - 1}
                                      className={buttonClass("secondary")}
                                    >
                                      {t("common.moveDown")}
                                    </button>
                                  </form>
                                  <form action={toggleArchiveAction}>
                                    <input type="hidden" name="accountId" value={account.id} />
                                    <button type="submit" className={buttonClass("secondary")}>
                                      {account.activeTo === null
                                        ? t("common.archive")
                                        : t("common.unarchive")}
                                    </button>
                                  </form>
                                  <form action={deleteAccountAction} className="ml-auto">
                                    <input type="hidden" name="accountId" value={account.id} />
                                    <button type="submit" className={buttonClass("danger")}>
                                      {t("common.delete")}
                                    </button>
                                  </form>
                                </div>
                              </div>
                            </details>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
            </Card>
          </section>
        );
      })}

      <Link
        href={showArchived === "1" ? "/accounts" : "/accounts?showArchived=1"}
        className={buttonClass("ghost")}
      >
        {t("accounts.showArchived")}
      </Link>
    </div>
  );
}
