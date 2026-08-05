import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";

/**
 * A deployment self-check, for when sign-in fails and the browser will
 * only say "Configuration".
 *
 * Every failure this diagnoses looks identical from the outside: a
 * missing table, an unset variable and a bad token all end as the same
 * generic error page, and the detail lives in a hosting provider's log
 * that may or may not be readable. This answers the two questions worth
 * asking — is the app talking to the database it thinks it is, and does
 * that database have the schema — without needing the logs at all.
 *
 * **Off unless DIAGNOSTICS=1.** It reports which variables are *set*,
 * never their values, but even that is more than a public URL should
 * volunteer; it is meant to be switched on for the length of one
 * investigation and switched back off.
 */
export const dynamic = "force-dynamic";

const REQUIRED_TABLES = [
  "sections",
  "accounts",
  "transactions",
  "transaction_lines",
  "exchange_rates",
  "budgets",
  "auth_user",
  "auth_account",
  "auth_session",
  "auth_verification_token",
];

/** Host only — the URL carries the organisation name, the token nothing. */
function databaseHost(): string {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) return "local file (TURSO_DATABASE_URL is not set)";
  if (url.startsWith("file:")) return `local file (${url})`;
  try {
    return new URL(url.replace(/^libsql:/, "https:")).host;
  } catch {
    return "unparseable TURSO_DATABASE_URL";
  }
}

export async function GET() {
  // 403 rather than 404, and it says which switch. Answering 404 made
  // "this build does not have the route yet" and "the route is here but
  // switched off" indistinguishable — during the one investigation this
  // exists for, that is the difference between redeploying and setting a
  // variable. Admitting the route exists costs nothing; it still reports
  // nothing about the deployment until it is turned on.
  if (process.env.DIAGNOSTICS !== "1") {
    return NextResponse.json(
      { error: "Diagnostics are off. Set DIAGNOSTICS=1 in the environment and redeploy." },
      { status: 403 },
    );
  }

  const environment = {
    TURSO_DATABASE_URL: Boolean(process.env.TURSO_DATABASE_URL),
    TURSO_AUTH_TOKEN: Boolean(process.env.TURSO_AUTH_TOKEN),
    AUTH_SECRET: Boolean(process.env.AUTH_SECRET),
    AUTH_GOOGLE_ID: Boolean(process.env.AUTH_GOOGLE_ID),
    AUTH_GOOGLE_SECRET: Boolean(process.env.AUTH_GOOGLE_SECRET),
    // The count, not the addresses: enough to tell "unset" from "set",
    // which is the whole question, without printing anyone's email.
    ALLOWED_EMAILS: (process.env.ALLOWED_EMAILS ?? "").split(",").filter((e) => e.trim()).length,
  };

  try {
    const rows = await db.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table'`,
    );
    const present = new Set(rows.map((r) => r.name));
    const missing = REQUIRED_TABLES.filter((t) => !present.has(t));

    return NextResponse.json({
      database: { host: databaseHost(), reachable: true, missingTables: missing },
      environment,
      // The one sentence a reader needs, rather than leaving them to
      // work it out from the arrays.
      verdict:
        missing.length > 0
          ? `Schema is missing ${missing.length} table(s). Run: npm run db:migrate:prod`
          : "Database reachable and schema complete.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        database: {
          host: databaseHost(),
          reachable: false,
          error: error instanceof Error ? error.message : String(error),
          cause:
            error instanceof Error && error.cause instanceof Error ? error.cause.message : null,
        },
        environment,
        verdict: "Could not query the database — check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.",
      },
      { status: 500 },
    );
  }
}
