import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { authSessions, authUsers } from "../db/schema";

export interface SeededSession {
  token: string;
  userId: string;
}

/**
 * Seeds a session directly into the DB and returns its token, bypassing
 * real OAuth (which E2E can't drive without live Google/Naver
 * credentials). Use with context.addCookies to authenticate a Playwright
 * browser context. Also returns userId — sections have UUID ids, so
 * "the last-created section" is not recoverable by sorting id, and a
 * test that needs its own section back should look it up by this
 * userId rather than guessing.
 */
export async function seedSession(email: string): Promise<SeededSession> {
  let user = await db.query.authUsers.findFirst({
    where: eq(authUsers.email, email),
  });
  if (!user) {
    const [created] = await db.insert(authUsers).values({ email }).returning();
    user = created;
  }

  const sessionToken = randomUUID();
  await db.insert(authSessions).values({
    sessionToken,
    userId: user.id,
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  return { token: sessionToken, userId: user.id };
}

export const SESSION_COOKIE_NAME = "authjs.session-token";
