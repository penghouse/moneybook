import { auth } from "@/auth";

/**
 * Every server action calls this itself rather than trusting proxy.ts —
 * proxy is an optimistic UX redirect, not a substitute for real
 * per-request authorization (see proxy.ts).
 */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }
  return session.user.id;
}
