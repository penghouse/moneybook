import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { getTranslations } from "@/i18n";
import { GoogleButton } from "../_components/google-button";
import { buttonClass, Card, Hint } from "../_components/ui";

/**
 * The one screen that predates the design system, now on its tokens.
 *
 * The error handling is the substance of this file. next-auth sends
 * every failure here as `?error=<code>`, and the page used to show
 * "이 계정은 허용되지 않았습니다" for any of them — so a misconfigured
 * deployment reported itself as a rejected account, which sends you
 * looking in exactly the wrong place.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session) redirect("/");

  const { t } = await getTranslations();
  const { error } = await searchParams;

  // An empty allowlist blocks everyone by design (auth.ts fails closed),
  // and that is a deployment mistake rather than a decision about the
  // person trying to sign in — so it says so instead of blaming them.
  const allowlistMissing = !(process.env.ALLOWED_EMAILS ?? "").trim();

  const message = !error
    ? null
    : error === "AccessDenied"
      ? allowlistMissing
        ? t("auth.notConfigured")
        : t("auth.denied")
      : t("auth.error").replace("{code}", error);

  return (
    <div className="mx-auto max-w-sm py-8">
      <h1 className="text-xl font-bold tracking-tight">{t("app.title")}</h1>
      <p className="text-ink-muted mt-1 text-sm">{t("app.tagline")}</p>

      {message && (
        <p className="bg-negative-soft text-negative rounded-control mt-4 px-3 py-2 text-sm">
          {message}
        </p>
      )}

      <Card className="mt-6">
        <div className="space-y-2 px-4 py-4">
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/" });
            }}
          >
            <GoogleButton label={t("auth.loginWithGoogle")} />
          </form>

          {process.env.AUTH_NAVER_ID && (
            <form
              action={async () => {
                "use server";
                await signIn("naver", { redirectTo: "/" });
              }}
            >
              <button type="submit" className={buttonClass("secondary", true)}>
                {t("auth.loginWithNaver")}
              </button>
            </form>
          )}
        </div>
      </Card>

      <Hint>{t("auth.allowlistHint")}</Hint>
    </div>
  );
}
