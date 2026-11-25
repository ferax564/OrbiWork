import { EnvironmentId } from "@orbiwork/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";

import {
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
  type ConnectionRoute,
} from "./catalog.ts";
import { pullRequestRoutingConnectionKey } from "./pullRequestRoutingPermissions.ts";
import { BearerConnectionTarget } from "./model.ts";
import {
  connectionRouteId,
  connectionRouteKind,
  connectionRouteLabel,
  credentialConnectionId,
  insertRoute,
  entryWithRoutes,
  isNearbyAddress,
  mergeLearnedRoutes,
  pendingRouteOrder,
  routeKeepsItsHost,
  routesAfterRemoving,
  sendsTokenInClear,
  upsertRoute,
  usableRoutes,
} from "./routes.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

function direct(id: string, httpBaseUrl: string): ConnectionRoute {
  return {
    target: new BearerConnectionTarget({
      environmentId: ENVIRONMENT_ID,
      label: "Desk",
      connectionId: id,
    }),
    profile: Option.some(
      new BearerConnectionProfile({
        connectionId: id,
        environmentId: ENVIRONMENT_ID,
        label: "Desk",
        httpBaseUrl,
        wsBaseUrl: httpBaseUrl.replace(/^http/, "ws"),
      }),
    ),
  };
}

const LAN = direct("lan", "http://192.168.1.10:3773/");
const TAILNET = direct("tailnet", "https://desk.tail1234.ts.net/");
const PUBLIC = direct("public", "https://desk.example.com/");

function learned(id: string, httpBaseUrl: string): ConnectionRoute {
  const route = direct(id, httpBaseUrl);
  const profile = Option.getOrThrow(route.profile) as BearerConnectionProfile;
  return {
    target: route.target,
    profile: Option.some(new BearerConnectionProfile({ ...profile, learned: true })),
  };
}

describe("connection routes", () => {
  it("classifies direct routes by address", () => {
    expect(connectionRouteKind(LAN)).toBe("lan");
    // Tailscale, Cloudflare WARP and Mesh, and other VPNs share 100.64.0.0/10.
    expect(connectionRouteKind(direct("ip", "http://100.101.102.103:3773/"))).toBe("vpn");
    expect(connectionRouteLabel(direct("mesh", "http://100.96.0.1:3773/"))).toBe("VPN");
    expect(connectionRouteKind(TAILNET)).toBe("tailnet");
    expect(connectionRouteKind(PUBLIC)).toBe("public");
    expect(connectionRouteKind(direct("lo", "http://127.0.0.1:3773/"))).toBe("loopback");
    expect(connectionRouteKind(direct("ts6", "http://[fd7a:115c:a1e0::1]:3773/"))).toBe("tailnet");
    expect(connectionRouteLabel(direct("ts-ip", "http://[fd7a:115c:a1e0::1]:3773/"))).toBe(
      "Tailscale",
    );
    expect(connectionRouteLabel(direct("ts-serve", "https://box.tail1234.ts.net/"))).toBe(
      "Tailscale HTTPS",
    );
  });

  it("knows which addresses reach the same machine on every network", () => {
    const tailnetIp = direct("ts-ip", "http://100.101.102.103:3773/");
    const profile = Option.getOrThrow(tailnetIp.profile) as BearerConnectionProfile;
    const marked = {
      target: tailnetIp.target,
      profile: Option.some(new BearerConnectionProfile({ ...profile, network: "tailscale" })),
    };
    expect(routeKeepsItsHost(PUBLIC)).toBe(true);
    expect(routeKeepsItsHost(direct("ts-tls", "https://desk.tail1234.ts.net/"))).toBe(true);
    expect(routeKeepsItsHost(direct("lo", "http://127.0.0.1:3773/"))).toBe(true);
    // With Tailscale down, a plain http tailnet address can reach another host:
    // carrier networks use 100.64.0.0/10 too, and nothing proves who answers.
    expect(routeKeepsItsHost(direct("ts", "http://desk.tail1234.ts.net:3773/"))).toBe(false);
    expect(routeKeepsItsHost(marked)).toBe(false);
    expect(routeKeepsItsHost(tailnetIp)).toBe(false);
    expect(routeKeepsItsHost(LAN)).toBe(false);
    expect(routeKeepsItsHost(direct("http", "http://desk.example.com/"))).toBe(false);
  });

  it("treats only loopback and LAN addresses as nearby", () => {
    expect(isNearbyAddress("http://127.0.0.1:3773/")).toBe(true);
    expect(isNearbyAddress("http://192.168.1.10:3773/")).toBe(true);
    expect(isNearbyAddress("http://100.101.102.103:3773/")).toBe(false);
    expect(isNearbyAddress("https://desk.tail1234.ts.net/")).toBe(false);
    expect(isNearbyAddress("https://desk.example.com/")).toBe(false);
    expect(isNearbyAddress("not a url")).toBe(false);
  });

  it("places a new route after faster kinds and ahead of slower ones", () => {
    expect(insertRoute([PUBLIC], LAN)).toEqual([LAN, PUBLIC]);
    expect(insertRoute([LAN, PUBLIC], TAILNET)).toEqual([LAN, TAILNET, PUBLIC]);
    expect(insertRoute([TAILNET], LAN)).toEqual([LAN, TAILNET]);
    expect(insertRoute([LAN, TAILNET], PUBLIC)).toEqual([LAN, TAILNET, PUBLIC]);
  });

  it("keeps a user's order when a saved route is replaced", () => {
    const repaired = direct("lan", "http://192.168.1.11:3773/");
    expect(upsertRoute([PUBLIC, LAN], repaired)).toEqual([PUBLIC, repaired]);
  });

  it("puts a newly paired route ahead of saved routes of the same kind", () => {
    const pasted = direct("lan-2", "http://192.168.1.11:3773/");
    expect(upsertRoute([LAN, TAILNET], pasted)).toEqual([pasted, LAN, TAILNET]);
  });

  it("keeps a newly paired route behind a different kind of the same rank", () => {
    const vpn = direct("vpn", "http://100.101.102.103:3773/");
    const pasted = direct("ts-2", "http://[fd7a:115c:a1e0::2]:3773/");
    expect(upsertRoute([vpn, TAILNET], pasted)).toEqual([vpn, pasted, TAILNET]);
  });

  it("shows a dragged order only until the saved routes catch up or change", () => {
    const dragged = ["tailnet", "lan"];
    expect(pendingRouteOrder(dragged, ["lan", "tailnet"])).toBe(dragged);
    expect(pendingRouteOrder(dragged, ["tailnet", "lan"])).toBeNull();
    expect(pendingRouteOrder(dragged, ["lan", "public"])).toBeNull();
    expect(pendingRouteOrder(dragged, ["lan", "tailnet", "public"])).toBeNull();
  });
});

describe("learned routes", () => {
  const entryOf = (routes: ReadonlyArray<ConnectionRoute>): ConnectionCatalogEntry =>
    entryWithRoutes(
      { target: routes[0]!.target, profile: routes[0]!.profile, enabled: true },
      routes,
    );
  const publicOnly = entryOf([PUBLIC]);
  const lanOnly = entryOf([LAN]);
  const ids = (routes: ReadonlyArray<ConnectionRoute> | null) =>
    routes?.map((route) => connectionRouteId(route.target)) ?? null;
  const profileOf = (route: ConnectionRoute) => Option.getOrThrow(route.profile);
  const TAILNET_ORIGIN = "https://desk.tail1234.ts.net";

  it("learns a reported address ahead of slower routes, borrowing the paired credential", () => {
    const routes = mergeLearnedRoutes({
      entry: publicOnly,
      activeRoute: PUBLIC,
      reported: [{ httpBaseUrl: `${TAILNET_ORIGIN}/` }],
      allowInsecure: true,
    });
    expect(ids(routes)).toEqual([`learned:${ENVIRONMENT_ID}:${TAILNET_ORIGIN}@public`, "public"]);
    expect(profileOf(routes![0]!)).toMatchObject({
      learned: true,
      wsBaseUrl: "wss://desk.tail1234.ts.net/",
    });
  });

  it("replaces a learned LAN address when the server reports a new one", () => {
    const first = mergeLearnedRoutes({
      entry: lanOnly,
      activeRoute: LAN,
      reported: [{ httpBaseUrl: "http://10.0.0.42:3773/" }],
      allowInsecure: true,
    })!;
    const moved = mergeLearnedRoutes({
      entry: entryOf(first),
      activeRoute: LAN,
      reported: [{ httpBaseUrl: "http://10.0.0.43:3773/" }],
      allowInsecure: true,
    });
    expect(ids(moved)).toEqual(["lan", `learned:${ENVIRONMENT_ID}:http://10.0.0.43:3773@lan`]);
  });

  it("keeps a learned route where the user moved it while the server reports it", () => {
    const tailnet = { httpBaseUrl: `${TAILNET_ORIGIN}/` };
    const first = mergeLearnedRoutes({
      entry: publicOnly,
      activeRoute: PUBLIC,
      reported: [tailnet],
      allowInsecure: true,
    })!;
    const reordered = entryOf([first[1]!, first[0]!]);
    expect(
      mergeLearnedRoutes({
        entry: reordered,
        activeRoute: PUBLIC,
        reported: [tailnet],
        allowInsecure: true,
      }),
    ).toBeNull();
    const next = mergeLearnedRoutes({
      entry: reordered,
      activeRoute: PUBLIC,
      reported: [tailnet, { kind: "tailnet", httpBaseUrl: "http://100.101.102.103:3773/" }],
      allowInsecure: true,
    });
    expect(ids(next)).toEqual([
      `learned:${ENVIRONMENT_ID}:http://100.101.102.103:3773@public`,
      "public",
      `learned:${ENVIRONMENT_ID}:${TAILNET_ORIGIN}@public`,
    ]);
  });

  it("labels a learned address Tailscale only while the server reports it as tailnet", () => {
    const tailscale = { kind: "tailnet", httpBaseUrl: "http://100.101.102.103:3773/" };
    const mesh = { kind: "lan", httpBaseUrl: "http://100.96.0.1:3773/" };
    const first = mergeLearnedRoutes({
      entry: lanOnly,
      activeRoute: LAN,
      reported: [tailscale, mesh],
      allowInsecure: true,
    })!;
    expect(first.map(connectionRouteLabel)).toEqual(["LAN", "Tailscale", "VPN"]);

    const corrected = mergeLearnedRoutes({
      entry: entryOf(first),
      activeRoute: LAN,
      reported: [{ ...tailscale, kind: "lan" }, mesh],
      allowInsecure: true,
    })!;
    expect(ids(corrected)).toEqual(ids(first));
    expect(corrected.map(connectionRouteLabel)).toEqual(["LAN", "VPN", "VPN"]);
    expect(
      mergeLearnedRoutes({
        entry: entryOf(corrected),
        activeRoute: LAN,
        reported: [{ ...tailscale, kind: "lan" }, mesh],
        allowInsecure: true,
      }),
    ).toBeNull();
  });

  it("leaves user routes alone and does not learn an address already saved", () => {
    const entry = entryOf([LAN, PUBLIC]);
    expect(
      mergeLearnedRoutes({
        entry,
        activeRoute: PUBLIC,
        reported: [{ httpBaseUrl: "http://192.168.1.10:3773" }],
        allowInsecure: true,
      }),
    ).toBeNull();
    expect(
      mergeLearnedRoutes({ entry, activeRoute: PUBLIC, reported: [], allowInsecure: true }),
    ).toBeNull();
  });

  it("borrows the paired token when learned over a bearer route", () => {
    const routes = mergeLearnedRoutes({
      entry: lanOnly,
      activeRoute: LAN,
      reported: [{ httpBaseUrl: `${TAILNET_ORIGIN}/` }],
      allowInsecure: true,
    })!;
    const learned = routes.find((route) => connectionRouteKind(route) === "tailnet")!;
    expect(credentialConnectionId(connectionRouteId(learned.target))).toBe("lan");
  });

  it("keeps a token paired over HTTPS off plain HTTP addresses outside the tailnet", () => {
    const routes = mergeLearnedRoutes({
      entry: publicOnly,
      activeRoute: PUBLIC,
      reported: [
        { kind: "lan", httpBaseUrl: "http://192.168.1.10:3773/" },
        { kind: "tailnet", httpBaseUrl: "http://100.101.102.103:3773/" },
        { kind: "tailnet", httpBaseUrl: `${TAILNET_ORIGIN}/` },
      ],
      allowInsecure: true,
    });
    expect(ids(routes)).toEqual([
      `learned:${ENVIRONMENT_ID}:http://100.101.102.103:3773@public`,
      `learned:${ENVIRONMENT_ID}:${TAILNET_ORIGIN}@public`,
      "public",
    ]);
  });

  it("drops a stale plain HTTP route borrowing an HTTPS-paired token", () => {
    const lanOrigin = "http://10.0.0.42:3773";
    const stale = learned(`learned:${ENVIRONMENT_ID}:${lanOrigin}@public`, `${lanOrigin}/`);
    const entry = entryOf([stale, PUBLIC]);
    expect(sendsTokenInClear([stale, PUBLIC], stale)).toBe(true);
    expect(ids(usableRoutes(entry))).toEqual(["public"]);
    const routes = mergeLearnedRoutes({
      entry,
      activeRoute: PUBLIC,
      reported: [{ kind: "lan", httpBaseUrl: `${lanOrigin}/` }],
      allowInsecure: true,
    });
    // The stale route is gone, and the HTTPS-paired token does not learn it again.
    expect(ids(routes)).toEqual(["public"]);
  });

  it("keeps plain HTTP routes that don't borrow the active HTTPS-paired token", () => {
    const lanOrigin = "http://10.0.0.42:3773";
    const overLan = learned(`learned:${ENVIRONMENT_ID}:${lanOrigin}@lan`, `${lanOrigin}/`);
    const routes = mergeLearnedRoutes({
      entry: entryOf([overLan, LAN, PUBLIC]),
      activeRoute: PUBLIC,
      reported: [{ kind: "lan", httpBaseUrl: `${lanOrigin}/` }],
      allowInsecure: true,
    });
    expect(routes).toBeNull();
  });

  it("learns plain HTTP LAN addresses over a token paired over plain HTTP", () => {
    const routes = mergeLearnedRoutes({
      entry: lanOnly,
      activeRoute: LAN,
      reported: [{ kind: "lan", httpBaseUrl: "http://10.0.0.42:3773/" }],
      allowInsecure: true,
    });
    expect(ids(routes)).toEqual(["lan", `learned:${ENVIRONMENT_ID}:http://10.0.0.42:3773@lan`]);
  });

  it("skips plain HTTP from an HTTPS page and never learns loopback", () => {
    expect(
      mergeLearnedRoutes({
        entry: lanOnly,
        activeRoute: LAN,
        reported: [
          { httpBaseUrl: "http://10.0.0.42:3773/" },
          { httpBaseUrl: "http://127.0.0.1:3773/" },
        ],
        allowInsecure: false,
      }),
    ).toBeNull();
  });

  it("removes learned routes along with the route whose credential they borrow", () => {
    const overLan = mergeLearnedRoutes({
      entry: entryOf([LAN, PUBLIC]),
      activeRoute: LAN,
      reported: [{ httpBaseUrl: `${TAILNET_ORIGIN}/` }],
      allowInsecure: true,
    })!;
    expect(ids(routesAfterRemoving(overLan, "lan"))).toEqual(["public"]);
    expect(ids(routesAfterRemoving(overLan, "public"))).toHaveLength(2);
  });

  it("keeps pull request routing trust when a route is learned", () => {
    const learned = mergeLearnedRoutes({
      entry: publicOnly,
      activeRoute: PUBLIC,
      reported: [{ httpBaseUrl: `${TAILNET_ORIGIN}/` }],
      allowInsecure: true,
    })!;
    expect(pullRequestRoutingConnectionKey(entryOf(learned))).toBe(
      pullRequestRoutingConnectionKey(publicOnly),
    );
  });

  it("saves a scheme change on the same host as a new address", () => {
    const first = mergeLearnedRoutes({
      entry: publicOnly,
      activeRoute: PUBLIC,
      reported: [{ kind: "tailnet", httpBaseUrl: "http://desk.tail1234.ts.net:3773/" }],
      allowInsecure: true,
    })!;
    const moved = mergeLearnedRoutes({
      entry: entryOf(first),
      activeRoute: PUBLIC,
      reported: [{ kind: "tailnet", httpBaseUrl: "https://desk.tail1234.ts.net:3773/" }],
      allowInsecure: true,
    });
    expect(moved).not.toBeNull();
    expect(profileOf(moved![0]!)).toMatchObject({
      httpBaseUrl: "https://desk.tail1234.ts.net:3773/",
    });
  });
});
