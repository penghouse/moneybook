import type { TranslationKey } from "./index";

/**
 * The dictionaries are deliberately flat `key -> string` maps with no
 * templating engine; the only interpolation this app needs is a couple
 * of named slots in CSV import errors, so it is done here rather than by
 * pulling in an i18n runtime.
 */
export function interpolate(
  template: string,
  params: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export type Translate = (key: TranslationKey) => string;
