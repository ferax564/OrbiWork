import { GTProvider } from "gt-react";
import type { ReactNode } from "react";

import { DEFAULT_LOCALE } from "./locales";

const TRANSLATIONS = { [DEFAULT_LOCALE]: {} };

export function I18nProvider({ children }: { readonly children: ReactNode }) {
  return (
    <GTProvider locale={DEFAULT_LOCALE} translations={TRANSLATIONS}>
      {children}
    </GTProvider>
  );
}
