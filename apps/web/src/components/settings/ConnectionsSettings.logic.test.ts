import { type DesktopWslState, EnvironmentId } from "@orbiwork/contracts";
import { createAdvertisedEndpoint } from "@orbiwork/shared/advertisedEndpoint";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  applyWslEnableSelection,
  isPlainHttpPairingRefused,
  isServerNetworkAccessible,
  parseManualDesktopSshTarget,
  resolveAccessEnvironmentId,
  resolveCurrentOriginPairingUrl,
  resolveTailscaleServeBaseUrl,
  selectPairingEndpoint,
  selectQrEndpointOption,
  togglePairingScopeSelection,
} from "./ConnectionsSettings.logic";

describe("plain HTTP pairing refusal", () => {
  const endpoint = (id: string, httpBaseUrl: string, isDefault?: boolean) =>
    createAdvertisedEndpoint({
      id,
      label: id,
      provider: { id: "desktop-core", label: "Desktop", kind: "core", isAddon: false },
      httpBaseUrl,
      reachability: "lan",
      source: "desktop-core",
      ...(isDefault === undefined ? {} : { isDefault }),
    });
  const lan = endpoint("desktop-lan:192.168.1.5", "http://192.168.1.5:3773", true);
  const tailnet = endpoint("tailscale-ip:100.100.1.2", "http://100.100.1.2:3773");
  const magicDns = endpoint("tailscale-magicdns:box", "https://box.tail1.ts.net");

  it("marks only plain HTTP to a non-loopback, non-tailnet host", () => {
    expect(isPlainHttpPairingRefused(lan.httpBaseUrl, true)).toBe(true);
    expect(isPlainHttpPairingRefused(lan.httpBaseUrl, false)).toBe(false);
    expect(isPlainHttpPairingRefused("https://192.168.1.5:3773", true)).toBe(false);
    expect(isPlainHttpPairingRefused("http://127.0.0.1:3773", true)).toBe(false);
    expect(isPlainHttpPairingRefused("http://box.tail1.ts.net:3773", true)).toBe(false);
    expect(isPlainHttpPairingRefused(tailnet.httpBaseUrl, true)).toBe(false);
  });

  it("prefers a pairable endpoint over a saved or advertised plain HTTP default", () => {
    const lanKey = "desktop-core:lan:http";
    expect(selectPairingEndpoint([lan, tailnet, magicDns], lanKey, true)?.id).toBe(tailnet.id);
    expect(selectPairingEndpoint([lan, magicDns], null, true)?.id).toBe(magicDns.id);
    expect(selectPairingEndpoint([lan, tailnet], lanKey, false)?.id).toBe(lan.id);
    expect(selectPairingEndpoint([lan], null, true)?.id).toBe(lan.id);
  });
});

describe("togglePairingScopeSelection", () => {
  it.each([
    {
      label: "adds terminal:read when terminal:operate is selected",
      current: ["orchestration:read"],
      scope: "terminal:operate",
      checked: true,
      expected: ["orchestration:read", "terminal:operate", "terminal:read"],
    },
    {
      label: "drops terminal:operate when terminal:read is cleared",
      current: ["terminal:read", "terminal:operate", "filesystem:read"],
      scope: "terminal:read",
      checked: false,
      expected: ["filesystem:read"],
    },
    {
      label: "keeps terminal:read when terminal:operate is cleared",
      current: ["terminal:read", "terminal:operate"],
      scope: "terminal:operate",
      checked: false,
      expected: ["terminal:read"],
    },
    {
      label: "toggles unrelated scopes on their own",
      current: ["terminal:read"],
      scope: "filesystem:read",
      checked: true,
      expected: ["terminal:read", "filesystem:read"],
    },
  ] as const)("$label", ({ current, scope, checked, expected }) => {
    expect(togglePairingScopeSelection(current, scope, checked)).toEqual(expected);
  });
});

describe("parseManualDesktopSshTarget", () => {
  it.each(["22.5", "1e3", "2222garbage"])("rejects explicit port %j", (port) => {
    expect(() => parseManualDesktopSshTarget({ host: "devbox", username: "", port })).toThrow(
      "SSH port must be between 1 and 65535.",
    );
  });
});

describe("resolveCurrentOriginPairingUrl", () => {
  it.each([
    ["orbiwork://app/settings/connections", null],
    ["http://127.0.0.1:3774/settings", null],
    ["http://localhost:5173/", null],
    ["https://host.example.ts.net/settings", "https://host.example.ts.net/pair#token=abc"],
    ["http://192.168.1.20:3773/", "http://192.168.1.20:3773/pair#token=abc"],
  ])("from %s", (href, expected) => {
    expect(resolveCurrentOriginPairingUrl("abc", href)).toBe(expected);
  });
});

describe("resolveTailscaleServeBaseUrl", () => {
  it.each([
    ["https://host.tail.ts.net:441/", 443, "https://host.tail.ts.net"],
    ["https://host.tail.ts.net:441/", 444, "https://host.tail.ts.net:444"],
  ] as const)("previews %s on port %i", (httpBaseUrl, port, expected) => {
    expect(resolveTailscaleServeBaseUrl({ httpBaseUrl }, port, true)).toBe(expected);
  });

  it("returns null without a pending endpoint", () => {
    expect(resolveTailscaleServeBaseUrl(null, 443, true)).toBeNull();
  });

  it.each([
    ["https://host.tail.ts.net:441/", 0, false],
    ["not a URL", 443, true],
  ] as const)("preserves %s when port %i cannot be previewed", (httpBaseUrl, port, isPortValid) => {
    expect(resolveTailscaleServeBaseUrl({ httpBaseUrl }, port, isPortValid)).toBe(httpBaseUrl);
  });
});

const baseWslState: DesktopWslState = {
  enabled: false,
  distro: null,
  available: true,
  wslOnly: true,
  distros: [],
  preflightError: null,
};

describe("applyWslEnableSelection", () => {
  it("clears WSL-only and updates the distro before enabling both backends", async () => {
    const calls: Array<string> = [];
    let persistedWslOnly = true;
    let persistedDistro: string | null = "Ubuntu";
    const setWslDistro = vi.fn(async (distro: string | null) => {
      calls.push(`setWslDistro:${distro ?? "default"}`);
      persistedDistro = distro;
      return { ...baseWslState, distro, wslOnly: persistedWslOnly };
    });
    const setWslBackendEnabled = vi.fn(async (enabled: boolean) => {
      calls.push(`setWslBackendEnabled:${enabled}`);
      return {
        ...baseWslState,
        enabled,
        distro: persistedDistro,
        wslOnly: persistedWslOnly,
      };
    });
    const setWslOnly = vi.fn(async (enabled: boolean) => {
      calls.push(`setWslOnly:${enabled}`);
      persistedWslOnly = enabled;
      return { ...baseWslState, distro: persistedDistro, wslOnly: enabled };
    });

    const state = await applyWslEnableSelection({
      bridge: { setWslDistro, setWslBackendEnabled, setWslOnly },
      mode: "both",
      nextDistro: "Debian",
      persistedDistro: "Ubuntu",
    });

    expect(calls).toEqual(["setWslOnly:false", "setWslDistro:Debian", "setWslBackendEnabled:true"]);
    expect(state).toMatchObject({ enabled: true, distro: "Debian", wslOnly: false });
  });
});

describe("selectQrEndpointOption", () => {
  const options = [
    {
      id: "desktop-loopback:4780",
      preferenceKey: "desktop-core:loopback:http",
      qrShareable: false,
    },
    {
      id: "tailscale-ip:http://100.84.12.7:4780",
      preferenceKey: "tailscale:ip:http",
      qrShareable: true,
    },
    {
      id: "tailscale-ip:http://100.84.12.8:4780",
      preferenceKey: "tailscale:ip:http",
      qrShareable: true,
    },
    {
      id: "desktop-lan:http://192.168.1.42:4780",
      preferenceKey: "desktop-core:lan:http",
      qrShareable: true,
    },
  ];

  it("resolves an explicit selection by unique endpoint id, not the shared preference key", () => {
    expect(selectQrEndpointOption(options, "tailscale-ip:http://100.84.12.8:4780", null)?.id).toBe(
      "tailscale-ip:http://100.84.12.8:4780",
    );
  });

  it("skips non-QR-shareable options in the fallback so the panel never opens on loopback", () => {
    expect(selectQrEndpointOption(options, "tailscale-ip:gone", "nope")?.id).toBe(
      "tailscale-ip:http://100.84.12.7:4780",
    );
  });
});

describe("resolveAccessEnvironmentId", () => {
  const primary = EnvironmentId.make("primary");
  const service = EnvironmentId.make("service");
  const laptop = EnvironmentId.make("laptop");
  it.each([
    {
      label: "defaults to the primary environment",
      primaryEnvironmentId: primary,
      environments: [
        { environmentId: primary, connected: true },
        { environmentId: service, connected: true },
      ],
      selected: null,
      expected: primary,
    },
    {
      label: "falls back to a connected saved environment without a primary",
      primaryEnvironmentId: null,
      environments: [
        { environmentId: laptop, connected: false },
        { environmentId: service, connected: true },
      ],
      selected: null,
      expected: service,
    },
    {
      label: "keeps an explicit choice",
      primaryEnvironmentId: primary,
      environments: [
        { environmentId: primary, connected: true },
        { environmentId: laptop, connected: false },
      ],
      selected: laptop,
      expected: laptop,
    },
    {
      label: "drops a choice that is no longer listed",
      primaryEnvironmentId: null,
      environments: [{ environmentId: service, connected: true }],
      selected: laptop,
      expected: service,
    },
    {
      label: "has nothing to show without environments",
      primaryEnvironmentId: null,
      environments: [],
      selected: null,
      expected: null,
    },
  ])("$label", ({ primaryEnvironmentId, environments, selected, expected }) => {
    expect(resolveAccessEnvironmentId({ primaryEnvironmentId, environments, selected })).toBe(
      expected,
    );
  });
});

describe("isServerNetworkAccessible", () => {
  const served = [{ kind: "tailnet", httpBaseUrl: "https://host.example.ts.net:8443/" }] as const;
  it.each([
    { authPolicy: "remote-reachable", directEndpoints: undefined, expected: true },
    { authPolicy: "loopback-browser", directEndpoints: undefined, expected: false },
    { authPolicy: "loopback-browser", directEndpoints: [], expected: false },
    { authPolicy: "loopback-browser", directEndpoints: served, expected: true },
    { authPolicy: null, directEndpoints: served, expected: false },
  ] as const)("$authPolicy with $directEndpoints.length endpoints", (row) => {
    expect(isServerNetworkAccessible(row)).toBe(row.expected);
  });
});
