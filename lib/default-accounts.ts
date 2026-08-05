import { accounts, type AccountGroup } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Locale } from "@/i18n";

interface DefaultAccount {
  group: AccountGroup;
  name: string;
}

// Seeded once, at section creation, in whichever locale the user was on at
// the time (see i18n plan notes: account names are user data, not UI
// strings, so they are never re-translated after this).
const DEFAULT_ACCOUNTS: Record<Locale, DefaultAccount[]> = {
  ko: [
    { group: "asset", name: "현금" },
    { group: "asset", name: "은행" },
    { group: "liability", name: "신용카드" },
    { group: "equity", name: "기초자본" },
    { group: "expense", name: "식비" },
    { group: "expense", name: "교통비" },
    { group: "expense", name: "통신비" },
    { group: "expense", name: "생활용품" },
    { group: "income", name: "급여" },
    { group: "income", name: "이자수익" },
  ],
  en: [
    { group: "asset", name: "Cash" },
    { group: "asset", name: "Bank" },
    { group: "liability", name: "Credit Card" },
    { group: "equity", name: "Opening Balance" },
    { group: "expense", name: "Food" },
    { group: "expense", name: "Transport" },
    { group: "expense", name: "Utilities" },
    { group: "expense", name: "Groceries" },
    { group: "income", name: "Salary" },
    { group: "income", name: "Interest" },
  ],
};

export async function seedDefaultAccounts(
  db: Db,
  params: { sectionId: string; locale: Locale; baseCurrency: string },
): Promise<void> {
  const list = DEFAULT_ACCOUNTS[params.locale];
  await db.insert(accounts).values(
    list.map((a, i) => ({
      sectionId: params.sectionId,
      group: a.group,
      name: a.name,
      currency: params.baseCurrency,
      sortOrder: i,
    })),
  );
}
