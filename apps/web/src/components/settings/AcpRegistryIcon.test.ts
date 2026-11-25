import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  AcpRegistryAgentIcon,
  officialAcpRegistryIconUrlForAgentId,
  resolveOfficialAcpRegistryIconUrl,
} from "./AcpRegistryIcon";

describe("ACP Registry icon", () => {
  it("renders the generic glyph without loading the registry CDN", () => {
    const markup = renderToStaticMarkup(
      createElement(AcpRegistryAgentIcon, {
        icon: "https://cdn.agentclientprotocol.com/registry/icons/gemini.png",
      }),
    );
    expect(markup).toContain('data-slot="acp-icon-fallback"');
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("agentclientprotocol.com");
  });

  it("accepts only credential-free HTTPS URLs on the official CDN", () => {
    expect(
      resolveOfficialAcpRegistryIconUrl(
        "https://cdn.agentclientprotocol.com/registry/icons/gemini.png",
      ),
    ).toBe("https://cdn.agentclientprotocol.com/registry/icons/gemini.png");
    expect(
      resolveOfficialAcpRegistryIconUrl("http://cdn.agentclientprotocol.com/icon.png"),
    ).toBeNull();
    expect(
      resolveOfficialAcpRegistryIconUrl("https://cdn.agentclientprotocol.com.evil/icon.png"),
    ).toBeNull();
    expect(
      resolveOfficialAcpRegistryIconUrl("https://user@cdn.agentclientprotocol.com/icon.png"),
    ).toBeNull();
    expect(
      resolveOfficialAcpRegistryIconUrl("https://cdn.agentclientprotocol.com:8443/icon.png"),
    ).toBeNull();
    expect(officialAcpRegistryIconUrlForAgentId("kilo")).toBe(
      "https://cdn.agentclientprotocol.com/registry/v1/latest/kilo.svg",
    );
    expect(officialAcpRegistryIconUrlForAgentId("../kilo")).toBeNull();
  });
});
