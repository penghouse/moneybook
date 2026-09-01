import { getTranslations } from "@/i18n";
import { PageLoading } from "../_components/page-loading";

export default async function Loading() {
  const { t } = await getTranslations();
  return <PageLoading label={t("common.loading")} />;
}
