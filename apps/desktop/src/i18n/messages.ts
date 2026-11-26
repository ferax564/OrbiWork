import { decodeOptions, gtFallback } from "gt-i18n";

/**
 * Resolves a `msg()` string in English at call time. Variables are strings so ICU never
 * reformats a number (a PID of 12345 would print "12,345").
 */
export function m(message: string, variables: Readonly<Record<string, string>> = {}): string {
  const decoded = decodeOptions(message);
  const source = typeof decoded?.$_source === "string" ? decoded.$_source : message;
  const options = typeof decoded?.$_source === "string" ? decoded : variables;
  return gtFallback(source, { ...options, $locale: "en" });
}
