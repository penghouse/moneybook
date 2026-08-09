import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

const uuid = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

export const ACCOUNT_GROUPS = ["asset", "liability", "equity", "expense", "income"] as const;
export type AccountGroup = (typeof ACCOUNT_GROUPS)[number];

export const LINE_SIDES = ["left", "right"] as const;
export type LineSide = (typeof LINE_SIDES)[number];

export const TRANSACTION_KINDS = ["normal", "opening", "revaluation"] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export const RATE_SOURCES = ["api", "manual"] as const;
export type RateSource = (typeof RATE_SOURCES)[number];

// sql.raw, not plain string interpolation into sql`` — a CHECK clause in
// CREATE TABLE DDL is static text, and interpolating a JS string into
// sql`` binds it as a `?` parameter, which SQLite rejects inside DDL.
const DATE_GLOB = sql.raw("'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'");
const YEAR_MONTH_GLOB = sql.raw("'[0-9][0-9][0-9][0-9]-[0-9][0-9]'");
const YEAR_GLOB = sql.raw("'[0-9][0-9][0-9][0-9]'");

// ---- Domain: sections ----

export const sections = sqliteTable("sections", {
  id: uuid(),
  userId: text("user_id")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  baseCurrency: text("base_currency").notNull().default("KRW"),
  timezone: text("timezone").notNull().default("Asia/Seoul"),
  startDate: text("start_date").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  // Which destinations get a cell in the phone's bottom bar, as a
  // comma-separated list of hrefs (no href contains a comma, so this
  // needs no JSON). Validated on read against NAV_ITEMS — see
  // lib/nav-favorites.ts — so renaming or removing a route can never
  // leave a dead tab behind.
  navFavorites: text("nav_favorites").notNull().default("/,/assets,/income,/budget"),
  // The order the five account groups are listed in, comma-separated.
  // Which groups exist is fixed (ACCOUNT_GROUPS); only their order is the
  // book's to decide, and a ledger's owner has a stronger opinion about
  // it than the schema does — someone tracking a mortgage wants
  // liabilities up top, someone tracking spending wants expenses there.
  //
  // Validated on read against ACCOUNT_GROUPS — see lib/account-groups.ts
  // — so a stored value can never hide a group or invent one.
  groupOrder: text("group_order").notNull().default("asset,liability,equity,expense,income"),
});

// ---- Domain: accounts ----

export const accounts = sqliteTable(
  "accounts",
  {
    id: uuid(),
    sectionId: text("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    group: text("group", { enum: ACCOUNT_GROUPS }).notNull(),
    name: text("name").notNull(),
    currency: text("currency").notNull().default("KRW"),
    sortOrder: integer("sort_order").notNull().default(0),
    // When this account was in use, as an inclusive date interval; null
    // on either end means "no bound". Replaces the `is_archived` boolean
    // this table used to carry — "archived" is just this interval having
    // closed, and keeping both meant two sources of truth for one
    // question ("can I pick this account today?") that could contradict
    // each other. The interval also says things the boolean could not:
    // an account that closes next month, or one that did not exist yet
    // when a past budget was drawn up.
    //
    // Strictly a property of the *catalog*, never of the ledger. Balances
    // and flows are facts derived from transaction_lines and are never
    // filtered by this — see lib/accounts.ts.
    activeFrom: text("active_from"),
    activeTo: text("active_to"),
    memo: text("memo"),
    // Free-text parent grouping within a group — "식비" and "카페" both
    // under "먹는 것". Null means unfiled. Deliberately a plain column
    // rather than its own table: at one person's scale the only thing a
    // table buys is rename-in-one-place, and the entry forms offer the
    // existing values through a <datalist> so typos rarely split a group.
    category: text("category"),
    // A 거래처관리 account — 받을돈, 줄돈 and the like — whose balance is
    // only half the answer. What matters is *whose* it is, so its screen
    // breaks the balance down by counterparty.
    //
    // The counterparty is the transaction's own 적요, not a new field:
    // on an account like this the 적요 already names who the money is
    // with, and a second field would have to be kept in step with it by
    // hand on every entry. So this flag changes only how the account is
    // *read* — nothing about how a transaction is written, and no column
    // that can drift out of agreement with the one beside it.
    //
    // Only meaningful on asset and liability accounts: a counterparty
    // balance is money outstanding, which is a level, and income/expense
    // accounts have no balance to break down — only flows. That rule is
    // enforced in the write paths rather than by a CHECK here, because
    // SQLite cannot attach one to a column added by ALTER TABLE, and the
    // rebuild that would be needed instead has to drop `accounts` while
    // transaction_lines and budgets reference it. The two write paths
    // (the accounts form and the CSV import) both check it; see
    // lib/accounts.ts.
    tracksCounterparties: integer("tracks_counterparties", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (t) => [
    unique("accounts_section_name_unique").on(t.sectionId, t.name),
    index("accounts_section_group_idx").on(t.sectionId, t.group),
    check(
      "accounts_group_check",
      sql`${t.group} IN ('asset','liability','equity','expense','income')`,
    ),
    check(
      "accounts_active_from_format_check",
      sql`${t.activeFrom} IS NULL OR ${t.activeFrom} GLOB ${DATE_GLOB}`,
    ),
    check(
      "accounts_active_to_format_check",
      sql`${t.activeTo} IS NULL OR ${t.activeTo} GLOB ${DATE_GLOB}`,
    ),
    // An interval ending before it starts is a slip, not a state worth
    // representing. Note what this does *not* say: nothing here
    // constrains the transactions posted to the account. An import
    // brings in years of history before anyone sets a window, and a late
    // correction can legitimately fall outside one. The window governs
    // what the pickers offer and what may be written next — never what
    // is already there.
    check(
      "accounts_active_range_check",
      sql`${t.activeFrom} IS NULL OR ${t.activeTo} IS NULL OR ${t.activeFrom} <= ${t.activeTo}`,
    ),
  ],
);

// ---- Domain: transactions + transaction_lines ----

export const transactions = sqliteTable(
  "transactions",
  {
    id: uuid(),
    sectionId: text("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    title: text("title").notNull(),
    memo: text("memo"),
    kind: text("kind", { enum: TRANSACTION_KINDS }).notNull().default("normal"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("transactions_section_date_idx").on(t.sectionId, t.date),
    check("transactions_kind_check", sql`${t.kind} IN ('normal','opening','revaluation')`),
    check("transactions_date_format_check", sql`${t.date} GLOB ${DATE_GLOB}`),
  ],
);

export const transactionLines = sqliteTable(
  "transaction_lines",
  {
    id: uuid(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    lineOrder: integer("line_order").notNull().default(0),
    side: text("side", { enum: LINE_SIDES }).notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    currency: text("currency").notNull(),
    // Minor-unit amount in this line's own currency. Always >= 0;
    // direction comes from `side`, never from the sign of the number.
    amount: integer("amount").notNull(),
    // Exchange rate to the section's base currency at entry time.
    // Null only for revaluation lines (kind='revaluation'), where the
    // line moves baseAmount without moving the foreign-currency amount.
    rate: real("rate"),
    // Minor-unit amount in the section's base currency, fixed at entry
    // time. This is what balances across a transaction, never `amount`.
    baseAmount: integer("base_amount").notNull(),
    memo: text("memo"),
  },
  (t) => [
    index("transaction_lines_transaction_idx").on(t.transactionId),
    index("transaction_lines_account_idx").on(t.accountId),
    check("transaction_lines_side_check", sql`${t.side} IN ('left','right')`),
    check("transaction_lines_amount_check", sql`${t.amount} >= 0`),
    check("transaction_lines_base_amount_check", sql`${t.baseAmount} >= 0`),
  ],
);

// ---- Domain: exchange_rates ----

export const exchangeRates = sqliteTable(
  "exchange_rates",
  {
    date: text("date").notNull(),
    base: text("base").notNull(),
    quote: text("quote").notNull(),
    rate: real("rate").notNull(),
    source: text("source", { enum: RATE_SOURCES }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.date, t.base, t.quote] }),
    check("exchange_rates_source_check", sql`${t.source} IN ('api','manual')`),
    check("exchange_rates_date_format_check", sql`${t.date} GLOB ${DATE_GLOB}`),
  ],
);

// ---- Domain: budgets ----

export const BUDGET_PERIODS = ["month", "year"] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export const budgets = sqliteTable(
  "budgets",
  {
    id: uuid(),
    sectionId: text("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // A budget is set either for a month or for a whole year, and the
    // two answer different questions: the month is what you steer by,
    // the year is the cap you are checking the twelve months against.
    //
    // One table with a `period` discriminator rather than a second
    // `annual_budgets` table — that table would repeat section, account
    // and amount verbatim, and every query, CSV column and backup step
    // would then exist in two versions.
    //
    // Deliberately *not* an overall (account-less) yearly budget: the
    // total is the sum of the per-account yearly ones, so a nullable
    // account_id would buy nothing and cost the NOT NULL and the unique
    // index.
    period: text("period", { enum: BUDGET_PERIODS }).notNull().default("month"),
    // '2026-08' when period is 'month', '2026' when it is 'year'.
    periodKey: text("period_key").notNull(),
    // Minor-unit amount in the section's base currency.
    amount: integer("amount").notNull(),
  },
  (t) => [
    unique("budgets_account_period_unique").on(t.accountId, t.period, t.periodKey),
    check("budgets_period_check", sql`${t.period} IN ('month','year')`),
    // The key's shape is checked against the period it belongs to, so a
    // year budget cannot be filed under a month key or the reverse.
    check(
      "budgets_period_key_format_check",
      sql`(${t.period} = 'month' AND ${t.periodKey} GLOB ${YEAR_MONTH_GLOB})
       OR (${t.period} = 'year' AND ${t.periodKey} GLOB ${YEAR_GLOB})`,
    ),
  ],
);

// ---- Domain relations (for db.query.*) ----

export const sectionsRelations = relations(sections, ({ many }) => ({
  accounts: many(accounts),
  transactions: many(transactions),
  budgets: many(budgets),
}));

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  section: one(sections, {
    fields: [accounts.sectionId],
    references: [sections.id],
  }),
  lines: many(transactionLines),
  budgets: many(budgets),
}));

export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  section: one(sections, {
    fields: [transactions.sectionId],
    references: [sections.id],
  }),
  lines: many(transactionLines),
}));

export const transactionLinesRelations = relations(transactionLines, ({ one }) => ({
  transaction: one(transactions, {
    fields: [transactionLines.transactionId],
    references: [transactions.id],
  }),
  account: one(accounts, {
    fields: [transactionLines.accountId],
    references: [accounts.id],
  }),
}));

export const FORMULA_SCOPES = ["assets", "income"] as const;
export type FormulaScope = (typeof FORMULA_SCOPES)[number];

/**
 * A figure the book does not keep, worked out from ones it does.
 *
 * "살 수 있는 집값" is not an account and never will be — it is
 * 유동성자금 + 투자 − 묶인돈, then some arithmetic on top. Adding an
 * account for it would put a number in the ledger that no transaction
 * ever moved; adding a column for it would mean a new column for every
 * such question. So it is stored as a *recipe*, evaluated against
 * whatever the screen is showing.
 *
 * Scoped to one report because the terms mean different things on each:
 * on the balance sheet an account contributes its balance, on the income
 * statement the period's flow. A formula that could be read on both
 * would be two formulas wearing one name.
 *
 * `terms` is JSON rather than this codebase's usual delimited string.
 * The other lists (nav favourites, group order) are drawn from fixed
 * vocabularies with no delimiters in them; a term can name a 상위 그룹,
 * which is free text the reader typed and may contain any character at
 * all. Parsed defensively on read — see lib/formulas.ts — so a term
 * naming an account since deleted drops out instead of breaking the
 * report it sits under.
 */
export const formulas = sqliteTable(
  "formulas",
  {
    id: uuid(),
    sectionId: text("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    scope: text("scope", { enum: FORMULA_SCOPES }).notNull(),
    name: text("name").notNull(),
    /** JSON array of signed terms; see lib/formulas.ts. */
    terms: text("terms").notNull().default("[]"),
    /**
     * Arithmetic over `x`, the signed sum of the terms — "(x-3.1e8)/2".
     * Empty means the sum itself, which is the common case.
     */
    expression: text("expression").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("formulas_section_scope_idx").on(t.sectionId, t.scope, t.sortOrder),
    check("formulas_scope_check", sql`${t.scope} IN ('assets','income')`),
  ],
);

export const formulasRelations = relations(formulas, ({ one }) => ({
  section: one(sections, {
    fields: [formulas.sectionId],
    references: [sections.id],
  }),
}));

export const budgetsRelations = relations(budgets, ({ one }) => ({
  section: one(sections, {
    fields: [budgets.sectionId],
    references: [sections.id],
  }),
  account: one(accounts, {
    fields: [budgets.accountId],
    references: [accounts.id],
  }),
}));

// ---- Auth.js (Drizzle adapter) tables ----
//
// Prefixed with auth_ because the adapter's default "account" table name
// collides with the domain `accounts` (chart of accounts) table above.
// Column shapes must match @auth/drizzle-adapter's SQLiteDrizzleAdapter
// exactly (see its lib/sqlite.js defineTables()) since the adapter reads
// these tables by property name, not by inference.

export const authUsers = sqliteTable("auth_user", {
  id: uuid(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: integer("email_verified", { mode: "timestamp_ms" }),
  image: text("image"),
});

export const authAccounts = sqliteTable(
  "auth_account",
  {
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const authSessions = sqliteTable("auth_session", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

export const authVerificationTokens = sqliteTable(
  "auth_verification_token",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ---- Row types ----

export type Section = typeof sections.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type TransactionLine = typeof transactionLines.$inferSelect;
export type ExchangeRate = typeof exchangeRates.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
