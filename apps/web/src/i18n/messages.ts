import { decodeOptions, gtFallback, type useMessages } from "gt-react";

import { DEFAULT_LOCALE } from "./locales";

export type MessageResolver = ReturnType<typeof useMessages>;

/** The UI language for Intl formatting outside React; components use GT's `useLocale()`. */
export function getActiveLocale(): string {
  return DEFAULT_LOCALE;
}

function resolve(message: string, variables: Parameters<MessageResolver>[1] = {}): string {
  const decoded = decodeOptions(message);
  const source = typeof decoded?.$_source === "string" ? decoded.$_source : message;
  const options = typeof decoded?.$_source === "string" ? decoded : variables;
  return gtFallback(source, { ...options, $locale: DEFAULT_LOCALE });
}

/**
 * Resolves a `msg()` string at call time, for code outside React (toasts, stores,
 * announcements). Never initializes GT, so it also runs in unit tests.
 */
export const m = ((message, variables) =>
  typeof message === "string" ? resolve(message, variables) : message) as MessageResolver;
