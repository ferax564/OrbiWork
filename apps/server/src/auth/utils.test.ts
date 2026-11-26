import { describe, expect, it } from "vite-plus/test";

import {
  arrivesOverHttps,
  deriveAuthClientMetadata,
  arrivesOverPrivateTransport,
  resolveSessionCookieName,
} from "./utils.ts";

describe("arrivesOverPrivateTransport", () => {
  const address = (value: string) => ({ address: value }) as never;
  const interfaces = {
    en0: [address("192.168.1.2")],
    // A carrier network uses the same IPv4 range as a tailnet.
    wwan0: [address("100.64.0.7")],
    utun4: [address("100.69.10.1"), address("fd7a:115c:a1e0::1")],
  };
  const from = (
    remoteAddress: string | undefined,
    localAddress = "192.168.1.2",
    headers: Record<string, string> = {},
  ) =>
    arrivesOverPrivateTransport(
      { headers, source: { socket: { remoteAddress, localAddress } } } as never,
      interfaces,
    );

  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1", "fd7a:115c:a1e0::9"])(
    "trusts loopback and Tailscale IPv6 peer %s",
    (peer) => expect(from(peer)).toBe(true),
  );

  it("trusts a carrier-range peer only on the Tailscale interface", () => {
    expect(from("100.101.102.103", "::ffff:100.69.10.1")).toBe(true);
    expect(from("100.101.102.103", "100.64.0.7")).toBe(false);
    expect(from("100.101.102.103", "192.168.1.2")).toBe(false);
  });

  it.each(["192.168.1.20", "10.0.0.5", "::ffff:192.168.1.20", "203.0.113.9", "fe80::1", undefined])(
    "does not trust peer %s",
    (peer) => expect(from(peer)).toBe(false),
  );

  it("ignores forwarding headers from a network peer", () => {
    expect(
      from("192.168.1.20", "192.168.1.2", {
        "x-forwarded-for": "127.0.0.1",
        "x-forwarded-proto": "https",
      }),
    ).toBe(false);
  });
});

describe("arrivesOverHttps", () => {
  const from = (socket: object, headers: Record<string, string> = {}) =>
    arrivesOverHttps({ headers, source: { socket } } as never);
  const proxied = { "x-forwarded-proto": "https" };

  it("trusts direct TLS and a loopback proxy that says https", () => {
    expect(from({ remoteAddress: "192.168.1.20", encrypted: true })).toBe(true);
    expect(from({ remoteAddress: "127.0.0.1" }, proxied)).toBe(true);
    expect(from({ remoteAddress: "::1" }, proxied)).toBe(true);
  });

  it("keeps plain HTTP and forged forwarding headers insecure", () => {
    expect(from({ remoteAddress: "127.0.0.1" })).toBe(false);
    expect(from({ remoteAddress: "192.168.1.20" }, proxied)).toBe(false);
    expect(from({ remoteAddress: "100.101.102.103" }, proxied)).toBe(false);
  });
});

describe("deriveAuthClientMetadata", () => {
  it("labels Electron user agents as Electron instead of Chrome", () => {
    const metadata = deriveAuthClientMetadata({
      request: {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) orbiwork/0.0.15 Chrome/136.0.7103.93 Electron/36.3.2 Safari/537.36",
        },
        source: {
          remoteAddress: "::ffff:127.0.0.1",
        },
      } as never,
    });

    expect(metadata).toMatchObject({
      browser: "Electron",
      deviceType: "desktop",
      ipAddress: "127.0.0.1",
      os: "macOS",
    });
  });

  it("records the forwarded client address of a request proxied by Tailscale Serve", () => {
    const metadata = deriveAuthClientMetadata({
      request: {
        headers: {
          "x-forwarded-for": "100.64.0.2",
          "x-forwarded-host": "host-a.tailnet-name.ts.net",
          "x-forwarded-proto": "https",
        },
        source: { remoteAddress: "127.0.0.1" },
      } as never,
    });

    expect(metadata.ipAddress).toBe("100.64.0.2");

    const direct = deriveAuthClientMetadata({
      request: {
        headers: { "x-forwarded-for": "100.64.0.2" },
        source: { remoteAddress: "192.168.1.20" },
      } as never,
    });
    expect(direct.ipAddress).toBe("192.168.1.20");
  });

  it.each([
    [
      "Edge on Android",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 EdgA/129.0.0.0",
      "Edge",
    ],
    [
      "Edge on iOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/129.0.2792.84 Mobile/15E148 Safari/605.1.15",
      "Edge",
    ],
    [
      "Firefox on iOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15",
      "Firefox",
    ],
    [
      "Opera on iOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 OPiOS/5.0.0 Mobile/15E148 Safari/605.1.15",
      "Opera",
    ],
  ])("labels %s by its own browser token", (_name, userAgent, browser) => {
    const metadata = deriveAuthClientMetadata({
      request: { headers: { "user-agent": userAgent }, source: {} } as never,
    });

    expect(metadata.browser).toBe(browser);
  });

  it("applies client-presented display identity without replacing transport metadata", () => {
    const metadata = deriveAuthClientMetadata({
      request: {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136.0.7103.93 Electron/36.3.2 Safari/537.36",
        },
        source: {
          remoteAddress: "::ffff:192.168.213.72",
        },
      } as never,
      presented: {
        label: "OrbiWork Mobile",
        deviceType: "mobile",
        os: "iOS",
      },
    });

    expect(metadata).toMatchObject({
      label: "OrbiWork Mobile",
      browser: "Electron",
      deviceType: "mobile",
      ipAddress: "192.168.213.72",
      os: "iOS",
    });
    expect(metadata.userAgent).toContain("Electron/36.3.2");
  });
});

describe("session cookie isolation", () => {
  it("isolates loopback web servers by port and server state", () => {
    const first = resolveSessionCookieName({
      mode: "web",
      port: 5775,
      host: "127.0.0.1",
      instanceKey: "/tmp/orbi-agent-one",
      environmentId: "environment-one",
      development: true,
    });
    const second = resolveSessionCookieName({
      mode: "web",
      port: 5775,
      host: "127.0.0.1",
      instanceKey: "/tmp/orbi-agent-two",
      environmentId: "environment-two",
      development: true,
    });

    expect(first).toMatch(/^orbi_session_5775_[a-f0-9]{12}$/);
    expect(second).toMatch(/^orbi_session_5775_[a-f0-9]{12}$/);
    expect(first).not.toBe(second);
  });

  // regression: #8085 isolate remote web session cookies
  it("isolates remote web servers by server state", () => {
    const first = resolveSessionCookieName({
      mode: "web",
      port: 3773,
      host: "192.168.1.50",
      instanceKey: "/srv/orbi-one",
      environmentId: "environment-one",
      development: false,
    });
    const second = resolveSessionCookieName({
      mode: "web",
      port: 5775,
      host: "192.168.1.50",
      instanceKey: "/srv/orbi-two",
      environmentId: "environment-two",
      development: false,
    });

    expect(first).toMatch(/^orbi_session_[a-f0-9]{12}$/);
    expect(second).toMatch(/^orbi_session_[a-f0-9]{12}$/);
    expect(first).not.toBe(second);
  });

  it("keeps a remote web server cookie stable across port changes", () => {
    const first = resolveSessionCookieName({
      mode: "web",
      port: 8080,
      host: "0.0.0.0",
      instanceKey: "/srv/orbi",
      environmentId: "environment-one",
      development: false,
    });
    const second = resolveSessionCookieName({
      mode: "web",
      port: 9090,
      host: "app.example.com",
      instanceKey: "/srv/orbi",
      environmentId: "environment-one",
      development: false,
    });

    expect(first).toBe(second);
  });
});
