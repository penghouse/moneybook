"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { isTheme, themeCookieName } from "./theme";

export async function setTheme(theme: string) {
  if (!isTheme(theme)) return;
  const store = await cookies();
  store.set(themeCookieName, theme, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}
