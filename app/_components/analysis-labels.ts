import type { TranslationKey } from "@/i18n";
import type { AnalysisLabels } from "./analysis-sheet";

/**
 * The sheet's wording, in one place because three screens mount it.
 *
 * Only the default question differs between them — the rest of the sheet
 * is the same sheet, and three copies of the same twelve labels is three
 * chances for them to drift.
 */
export function analysisLabels(t: (key: TranslationKey) => string): AnalysisLabels {
  return {
    open: t("analysis.open"),
    title: t("analysis.title"),
    close: t("common.close"),
    reading: t("analysis.reading"),
    sent: t("analysis.sentCount"),
    sentCount: t("analysis.sentCount"),
    followUp: t("analysis.followUp"),
    send: t("analysis.send"),
    retry: t("analysis.retry"),
    disclaimer: t("analysis.disclaimer"),
    failed: t("analysis.failed"),
    notConfigured: t("analysis.notConfigured"),
  };
}

/** Whether the deployment can answer at all; the button is hidden if not. */
export function analysisEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
