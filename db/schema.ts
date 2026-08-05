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
    yearMonth: text("year_month").notNull(),
    // Minor-unit amount in the section's base currency.
    amount: integer("amount").notNull(),
  },
  (t) => [
    unique("budgets_account_year_month_unique").on(t.accountId, t.yearMonth),
    check("budgets_year_month_format_check", sql`${t.yearMonth} GLOB ${YEAR_MONTH_GLOB}`),
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
