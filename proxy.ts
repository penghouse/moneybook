import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Renamed from middleware.ts in Next.js 16. This is an optimistic,
// UX-level redirect only — every server action re-derives the user from
// auth() itself, since proxy is not a substitute for real authorization.
export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }
});

export const config = {
  // /api is excluded entirely: redirecting an unauthenticated API request
  // to the /login HTML page makes a client fetch fail on JSON parsing
  // instead of seeing the 401 the route handler is written to return.
  // Each handler authenticates for itself.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
