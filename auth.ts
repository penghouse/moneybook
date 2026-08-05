import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Naver from "next-auth/providers/naver";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/db/client";
import { authAccounts, authSessions, authUsers, authVerificationTokens } from "@/db/schema";

// Personal-use app: only these addresses may ever sign in. Anyone else
// authenticating with Google/Naver is refused before an account or
// session row is ever created for them.
const allowedEmails = new Set(
  (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: authUsers,
    accountsTable: authAccounts,
    sessionsTable: authSessions,
    verificationTokensTable: authVerificationTokens,
  }),
  // Naver only turns on once its credentials are configured, so an
  // unconfigured provider never shows up as a broken login option.
  providers: [Google, ...(process.env.AUTH_NAVER_ID ? [Naver] : [])],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user, profile }) {
      const email = profile?.email ?? user.email;
      if (!email) return false;
      // Fail closed: a blank ALLOWED_EMAILS should block everyone, not
      // accidentally allow everyone.
      if (allowedEmails.size === 0) return false;
      return allowedEmails.has(email.toLowerCase());
    },
    // Database session strategy only puts {name, email, image} on the
    // session by default; every server action needs the user id to scope
    // a section to its owner, so it's added here explicitly.
    async session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  logger: {
    /**
     * Auth.js prints only the outermost error, and Drizzle wraps the
     * driver's message in `cause` — so a failing sign-in logged
     * "Failed query: select … from auth_account" and kept the sentence
     * that actually said why ("no such table: auth_account") one level
     * down, invisible. Every layer gets printed here.
     *
     * Messages only, not the error objects: an Auth.js error can carry
     * request details, and this lands in a hosting provider's log.
     */
    error(error) {
      console.error(`[moneybook auth] ${error.name}: ${error.message}`);
      let cause: unknown = (error as { cause?: unknown }).cause;
      for (let depth = 0; cause instanceof Error && depth < 5; depth++) {
        console.error(`[moneybook auth]   caused by ${cause.name}: ${cause.message}`);
        cause = (cause as { cause?: unknown }).cause;
      }
    },
    warn(code) {
      console.warn(`[moneybook auth] ${code}`);
    },
  },
});
