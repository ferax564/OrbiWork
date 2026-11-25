import * as NodePathLayer from "@effect/platform-node/NodePath";
import * as HostProcess from "@orbiwork/shared/HostProcess";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import { vi } from "vite-plus/test";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopDeepLinks from "./DesktopDeepLinks.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopWebLinks from "./DesktopWebLinks.ts";

const pairLink = "orbiwork://pair?pairingUrl=https%3A%2F%2Fvps.example.com%2F%23token%3Dabc";

const codexAuthLink = () => {
  const authorize = new URL("https://auth.openai.com/api/accounts/authorize");
  authorize.search = new URLSearchParams({
    client_id: "dynamic_agent_client",
    response_type: "code",
    redirect_uri: "http://127.0.0.1:54213/auth/callback",
    state: "a".repeat(43),
    code_challenge_method: "S256",
    code_challenge: "b".repeat(43),
  }).toString();
  const request = JSON.stringify({
    authorizationUrl: authorize.toString(),
    returnUrl: "http://localhost:5733/welcome",
    environmentId: "remote-one",
    instanceId: "work",
    flowId: "flow-one",
  });
  return `orbiwork-dev://auth/codex?request=${encodeURIComponent(request)}`;
};

type Provided =
  | DesktopDeepLinks.DesktopDeepLinks
  | DesktopWebLinks.DesktopWebLinks
  | ElectronWindow.ElectronWindow
  | Scope.Scope;

interface Harness {
  readonly events: Array<string>;
  readonly listeners: Map<string, (...args: Array<unknown>) => void>;
  readonly received: Array<string>;
  readonly revealed: Array<unknown>;
  readonly layer: Layer.Layer<DesktopDeepLinks.DesktopDeepLinks>;
  readonly provide: <A, E>(effect: Effect.Effect<A, E, Provided>) => Effect.Effect<A, E>;
}

const harness = (options: { readonly locked?: boolean; readonly argv?: Array<string> } = {}) => {
  const events: Array<string> = [];
  const listeners = new Map<string, (...args: Array<unknown>) => void>();
  const received: Array<string> = [];
  const revealed: Array<unknown> = [];
  const window = { id: 1 };
  const electronApp = {
    setPath: (name: string, value: string) =>
      Effect.sync(() => void events.push(`setPath:${name}:${value}`)),
    requestSingleInstanceLock: Effect.sync(() => {
      events.push("requestSingleInstanceLock");
      return options.locked ?? true;
    }),
    quit: Effect.sync(() => void events.push("quit")),
    on: (name: string, listener: (...args: Array<unknown>) => void) =>
      Effect.sync(() => {
        events.push(`on:${name}`);
        listeners.set(name, listener);
      }),
  } as unknown as ElectronApp.ElectronApp["Service"];
  const layer = DesktopDeepLinks.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodePathLayer.layerPosix,
        Layer.succeed(
          DesktopEnvironment.DesktopEnvironment,
          DesktopEnvironment.DesktopEnvironment.of({
            stateDir: "/tmp/state",
            isDevelopment: false,
            appDataDirectory: "/tmp/app-data",
            platform: "darwin",
          } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]),
        ),
        Layer.succeed(ElectronApp.ElectronApp, electronApp),
        FileSystem.layerNoop({ exists: () => Effect.succeed(false) }),
      ),
    ),
  );
  const provide = <A, E>(effect: Effect.Effect<A, E, Provided>) =>
    effect.pipe(
      Effect.provide(layer),
      Effect.provideService(HostProcess.Arguments, options.argv ?? ["orbi"]),
      Effect.provideService(ElectronWindow.ElectronWindow, {
        currentMainOrFirst: Effect.succeedSome(window),
        reveal: (value: unknown) => Effect.sync(() => void revealed.push(value)),
      } as unknown as ElectronWindow.ElectronWindow["Service"]),
      Effect.provideService(
        DesktopWebLinks.DesktopWebLinks,
        DesktopWebLinks.DesktopWebLinks.of({
          receive: (url) => Effect.sync(() => void received.push(url)),
          setRendererReady: () => Effect.void,
        }),
      ),
      Effect.scoped,
    );
  return { events, listeners, received, revealed, layer, provide } satisfies Harness;
};

const openUrl = (h: Harness, url: string) => {
  const event = { preventDefault: vi.fn() };
  h.listeners.get("open-url")!(event, url);
  return event.preventDefault.mock.calls.length;
};

describe("DesktopDeepLinks", () => {
  it.effect("takes the single-instance lock and listens for links, nothing else", () => {
    const h = harness();
    return h
      .provide(
        Effect.gen(function* () {
          yield* (yield* DesktopDeepLinks.DesktopDeepLinks).configure;
        }),
      )
      .pipe(
        Effect.tap(() =>
          Effect.sync(() =>
            assert.deepEqual(h.events, [
              "setPath:userData:/tmp/app-data/orbiwork-v2",
              "requestSingleInstanceLock",
              "on:second-instance",
              "on:open-url",
            ]),
          ),
        ),
      );
  });

  it.effect("quits a second launch before the application runtime starts", () =>
    Effect.gen(function* () {
      const h = harness({ locked: false });
      const exit = yield* Effect.exit(Effect.scoped(Layer.build(h.layer)));
      assert.isTrue(Exit.hasInterrupts(exit));
      assert.deepEqual(h.events.slice(-1), ["quit"]);
    }),
  );

  it.effect("delivers queued pairing and prompt links once, in order, then later ones", () => {
    const h = harness({ argv: ["orbi", "orbiwork://new?prompt=startup"] });
    return h.provide(
      Effect.gen(function* () {
        const deepLinks = yield* DesktopDeepLinks.DesktopDeepLinks;
        h.listeners.get("second-instance")!({}, ["orbi", "orbiwork://threads/env-1/thread-1"]);
        assert.strictEqual(openUrl(h, pairLink), 1);
        assert.deepEqual(h.received, []);
        yield* deepLinks.configure;
        h.listeners.get("second-instance")!({}, ["orbi", "orbiwork://new?prompt=later"]);
        yield* Effect.yieldNow;
        assert.deepEqual(h.received, [
          "orbiwork://new?prompt=startup",
          pairLink,
          "orbiwork://threads/env-1/thread-1",
          "orbiwork://new?prompt=later",
        ]);
      }),
    );
  });

  it.effect(
    "ignores sign-in handoff, app navigation, web and file links from any entry point",
    () => {
      const ignored = [
        codexAuthLink(),
        codexAuthLink().replace("orbiwork-dev:", "orbiwork:"),
        "orbiwork://app/settings/providers?instanceId=work",
        "orbiwork-dev://app/welcome#agents:machine-id",
        "https://example.com/page",
        "http://localhost:3000/",
        "file:///tmp/page.html",
        "orbiwork://pair",
        "orbiwork://somewhere-else",
      ];
      const h = harness({ argv: ["orbi", ...ignored] });
      return h.provide(
        Effect.gen(function* () {
          for (const url of ignored) assert.strictEqual(openUrl(h, url), 0, url);
          yield* (yield* DesktopDeepLinks.DesktopDeepLinks).configure;
          for (const url of ignored) assert.strictEqual(openUrl(h, url), 0, url);
          h.listeners.get("second-instance")!({}, ["orbi", ...ignored]);
          yield* Effect.yieldNow;
          assert.deepEqual(h.received, []);
          // A second launch with nothing the app handles only brings the window forward.
          assert.deepEqual(h.revealed, [{ id: 1 }]);
          assert.isFalse(h.listeners.has("open-file"));
        }),
      );
    },
  );
});
