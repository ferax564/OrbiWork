import { describe, expect, it } from "@effect/vitest";

import { faviconUrlForOrigin, toolActivityFaviconUrl, toolActivityLogoUrl } from "./favicon.ts";

describe("faviconUrlForOrigin", () => {
  it("never builds a favicon request for an arbitrary public link", () => {
    expect(
      faviconUrlForOrigin("https://github.com:8443/ferax564/orbiwork?private=query", 64),
    ).toBeNull();
  });

  // regression: #5838 no favicon request for missing or non-http origins
  it.each([null, "invalid URL", "file:///tmp/private"])(
    "rejects an invalid or unsupported origin %s",
    (origin) => {
      expect(faviconUrlForOrigin(origin)).toBeNull();
    },
  );
});

describe("toolActivityFaviconUrl", () => {
  it("never builds a request to the visited site or a hosted icon", () => {
    expect(
      toolActivityFaviconUrl({ pageUrl: "https://example.com/docs/page?q=1" }, "light"),
    ).toBeNull();
    expect(toolActivityFaviconUrl({ pageUrl: "https://github.com/org/repo" }, "dark")).toBeNull();
    expect(
      toolActivityFaviconUrl(
        { pageUrl: "https://example.com/docs", faviconUrl: "https://example.com/icon.png" },
        "light",
      ),
    ).toBeNull();
    expect(
      toolActivityFaviconUrl(
        { pageUrl: "https://example.com/docs", faviconUrl: "chrome-extension://example/_favicon/" },
        "light",
      ),
    ).toBeNull();
  });

  it("keeps inline data icons a provider event supplied", () => {
    const light = "data:image/png;base64,AAAA";
    const dark = "data:image/png;base64,BBBB";
    const icon = { pageUrl: "https://example.com", faviconUrl: light, faviconUrlDark: dark };
    expect(toolActivityFaviconUrl(icon, "light")).toBe(light);
    expect(toolActivityFaviconUrl(icon, "dark")).toBe(dark);
    expect(
      toolActivityFaviconUrl({ ...icon, faviconUrlDark: "https://x.test/d.svg" }, "dark"),
    ).toBe(light);
  });
});

describe("toolActivityLogoUrl", () => {
  it("never loads a hosted connector logo and keeps inline ones", () => {
    const inline = "data:image/png;base64,AAAA";
    expect(
      toolActivityLogoUrl({ logoUrl: "https://cdn.example.com/logo.png" }, "light"),
    ).toBeNull();
    expect(
      toolActivityLogoUrl(
        { logoUrl: inline, logoUrlDark: "https://cdn.example.com/d.png" },
        "dark",
      ),
    ).toBe(inline);
  });
});
