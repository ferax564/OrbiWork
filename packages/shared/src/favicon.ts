/**
 * Only a `data:` icon a provider event carried inline is shown. Loading `<site>/favicon.ico` (or a
 * hosted themed icon) would tell that site the user's IP and that this app is looking at it.
 * Callers fall back to a generic icon.
 */
function inlineFaviconUrl(rawUrl: string | null | undefined): string | null {
  return rawUrl && rawUrl.length <= 1_000_000 && rawUrl.startsWith("data:image/") ? rawUrl : null;
}

export function toolActivityFaviconUrl(
  icon: {
    readonly pageUrl: string;
    readonly faviconUrl?: string | undefined;
    readonly faviconUrlDark?: string | undefined;
  },
  appearance: "light" | "dark",
): string | null {
  return (
    (appearance === "dark" ? inlineFaviconUrl(icon.faviconUrlDark) : null) ??
    inlineFaviconUrl(icon.faviconUrl)
  );
}

/** Same rule for a connector's themed logo: hosted logos are not fetched. */
export function toolActivityLogoUrl(
  icon: { readonly logoUrl: string; readonly logoUrlDark?: string | undefined },
  appearance: "light" | "dark",
): string | null {
  return (
    (appearance === "dark" ? inlineFaviconUrl(icon.logoUrlDark) : null) ??
    inlineFaviconUrl(icon.logoUrl)
  );
}

/**
 * Site icons for arbitrary links are not fetched: asking a third-party favicon service (or the
 * site itself) for every domain an agent mentions would disclose what is being discussed.
 * Callers fall back to a generic icon.
 */
export function faviconUrlForOrigin(_rawUrl: string | null | undefined, _size = 32): string | null {
  return null;
}
