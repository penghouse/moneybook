import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const url = process.env.TURSO_DATABASE_URL ?? "file:./moneybook.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

const client = createClient(authToken ? { url, authToken } : { url });

/**
 * A remote libSQL server refuses PRAGMA outright — it answers
 * `SQL_PARSE_ERROR: SQL not allowed statement`. Running these
 * unconditionally broke `next build` against Turso: the root layout
 * imports this module, so collecting page data for any route (even
 * `/_not-found`) executed them and failed the build.
 *
 * None of the three are ours to set remotely anyway. `busy_timeout` and
 * `journal_mode` describe how *this process* shares one local file, and
 * a hosted database manages its own concurrency. Foreign-key enforcement
 * is likewise a server-side setting there.
 *
 * That last one is worth knowing about rather than assuming: the schema
 * uses `onDelete: restrict` on transaction lines, and deleteAccountAction
 * relies on the database refusing to delete an account that still has
 * transactions. If a host ever ships with foreign keys off, that delete
 * would silently succeed and orphan the lines. The deployment checklist
 * verifies it once against the real database.
 */
const isLocalFile = url.startsWith("file:") || url === ":memory:";

if (isLocalFile) {
  // Local `file:` mode gets hit by several separate processes at once
  // (next build's parallel page-data workers, the dev server, the E2E
  // suite's direct DB access) — busy_timeout makes a connection wait and
  // retry instead of raising SQLITE_BUSY immediately, and WAL lets
  // readers and a writer proceed concurrently once that race is past.
  await client.execute("PRAGMA busy_timeout = 5000");
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA foreign_keys = ON");
}

export const db = drizzle(client, { schema });
