import { initializeGTSPA } from "gt-react";

import { DEFAULT_LOCALE } from "./locales";

/**
 * Sets up GT's singletons for English, the source text. The custom loader also keeps GT off its
 * CDN even if a `VITE_GT_PROJECT_ID` is in the environment.
 */
export function initializeI18n(): void {
  void initializeGTSPA({
    defaultLocale: DEFAULT_LOCALE,
    locales: [DEFAULT_LOCALE],
    locale: DEFAULT_LOCALE,
    loadTranslations: async () => ({}),
  });
}
