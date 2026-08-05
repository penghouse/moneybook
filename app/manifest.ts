import type { MetadataRoute } from "next";
import { getTranslations } from "@/i18n";

/**
 * Installed to the home screen, this opens without browser chrome —
 * which is the point for a ledger you reach for several times a day.
 *
 * Named from the same dictionary as the UI so an installed Korean book
 * doesn't sit on the home screen under an English label. Reading the
 * locale cookie makes this request-time rather than cached, which is the
 * right trade: the manifest is fetched once per install.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { locale, t } = await getTranslations();

  return {
    name: t("app.title"),
    short_name: t("app.title"),
    description: t("app.tagline"),
    lang: locale,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f2f4f6",
    theme_color: "#4338ca",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Kept separate from the `any` icons: a launcher crops a maskable
      // icon to its own shape, so this one carries the safe-zone padding
      // that would leave the others looking small in a browser tab.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
