import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { auth } from "@/auth";
import { db } from "@/db/client";
import { getTranslations } from "@/i18n";
import { getOrCreateSection } from "@/lib/current-section";
import { parseFavorites } from "@/lib/nav-favorites";
import { getTheme, themeAttribute } from "@/lib/theme";
import { DesktopNav } from "./_components/desktop-nav";
import { LocaleToggle } from "./_components/locale-toggle";
import { LogoutButton } from "./_components/logout-button";
import { MobileNav } from "./_components/mobile-nav";
import { NAV_ITEMS } from "./_components/nav-items";
import { ThemeToggle } from "./_components/theme-toggle";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "moneybook",
  description: "A personal double-entry ledger",
  appleWebApp: { capable: true, title: "moneybook", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // Two entries, so an installed app's status bar matches the page it is
  // sitting above rather than flashing the light paper colour in dark
  // mode. These are the --color-card values from globals.css.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#171c23" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale, t } = await getTranslations();
  const session = await auth();
  const theme = await getTheme();

  const items = NAV_ITEMS.map((item) => ({
    href: item.href,
    label: t(item.labelKey),
  }));
  const byHref = new Map(items.map((item) => [item.href, item] as const));

  // Signed out there is no book, and no bottom bar to fill.
  const signedIn = Boolean(session?.user);
  const section = signedIn
    ? await getOrCreateSection(db, { userId: session!.user!.id, locale })
    : null;
  const favorites = parseFavorites(section?.navFavorites).map((href) => byHref.get(href)!);
  const themeLabels = {
    legend: t("theme.toggle"),
    light: t("theme.light"),
    dark: t("theme.dark"),
    system: t("theme.system"),
  };
  return (
    <html
      lang={locale}
      // Absent for "system", which is what lets the prefers-color-scheme
      // fallback in globals.css take over.
      data-theme={themeAttribute(theme)}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="bg-paper text-ink flex min-h-full flex-col font-sans">
        <header className="border-rule bg-card sticky top-0 z-40 border-b">
          <div className="mx-auto flex w-full max-w-5xl items-center gap-1 px-2 py-2 md:px-4">
            <span className="px-2 font-semibold tracking-tight">{t("app.title")}</span>
            {signedIn && (
              <div className="ml-3 min-w-0">
                <DesktopNav items={items} />
              </div>
            )}

            {/* Signed in, these live in the drawer on mobile; signed out
                there is no drawer, so they stay in the header at every
                width and are allowed to wrap. */}
            <div
              // Only one display utility at the base width: `flex hidden`
              // together is decided by CSS source order, not by the order
              // written here.
              className={`ml-auto flex-wrap items-center justify-end gap-2 ${
                signedIn ? "hidden md:flex" : "flex"
              }`}
            >
              <ThemeToggle theme={theme} labels={themeLabels} />
              <LocaleToggle locale={locale} />
              {signedIn && <LogoutButton label={t("auth.logout")} />}
            </div>
          </div>
        </header>
        {/* pb-24: the bottom bar is fixed, so without room reserved here
            it sits on top of the last card on every page. */}
        <main
          className={`mx-auto w-full max-w-5xl flex-1 px-5 py-4 md:px-6 md:pb-4 ${
            signedIn ? "pb-24" : "pb-4"
          }`}
        >
          {children}
        </main>

        {/* After <main>, not inside the header: tabbing through a page
            should reach its content before the navigation that follows
            it visually at the bottom of the screen. */}
        {signedIn && (
          <MobileNav
            items={items}
            favorites={favorites}
            title={t("nav.menu")}
            moreLabel={t("nav.more")}
            closeLabel={t("nav.closeMenu")}
            footer={
              <>
                <ThemeToggle theme={theme} labels={themeLabels} full />
                <LocaleToggle locale={locale} full />
                <LogoutButton label={t("auth.logout")} full />
              </>
            }
          />
        )}
      </body>
    </html>
  );
}
