import type { AccountGroup } from "@/db/schema";
import type { TranslationKey } from "./index";

/**
 * What each 분류 is called on screen. One table, because three screens
 * were carrying their own copy and a fourth was about to.
 */
export const GROUP_LABEL_KEY: Record<AccountGroup, TranslationKey> = {
  asset: "group.asset",
  liability: "group.liability",
  equity: "group.equity",
  expense: "group.expense",
  income: "group.income",
};
