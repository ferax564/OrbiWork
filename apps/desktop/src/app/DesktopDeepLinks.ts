import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";

import { promptLinkAppPath } from "@orbiwork/shared/promptLinks";
import { readPairingAppLink } from "@orbiwork/shared/remote";
import * as HostProcess from "@orbiwork/shared/HostProcess";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopUserData from "./DesktopUserData.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopWebLinks from "./DesktopWebLinks.ts";

/**
 * The app's own `orbiwork://` links: pairing links and prompt links. Both reach the renderer, which
 * asks the user before it pairs or sends anything. Any other link, including `orbiwork://app/...`
 * and `orbiwork://auth/...`, is ignored, so a web page cannot start a sign-in or navigate the app.
 */
const isAppLink = (value: string | undefined): value is string =>
  value !== undefined && (promptLinkAppPath(value) !== null || readPairingAppLink(value) !== null);

export class DesktopDeepLinks extends Context.Service<
  DesktopDeepLinks,
  {
    readonly configure: Effect.Effect<
      void,
      never,
      ElectronWindow.ElectronWindow | DesktopWebLinks.DesktopWebLinks | Scope.Scope
    >;
  }
>()("@orbiwork/desktop/app/DesktopDeepLinks") {}

/** @public */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const electronApp = yield* ElectronApp.ElectronApp;

  const userDataPath = yield* DesktopUserData.resolveUserDataPath(environment);
  yield* electronApp.setPath("userData", userDataPath);

  // Interrupt before runtime construction because quit is asynchronous.
  if (!(yield* electronApp.requestSingleInstanceLock)) {
    yield* electronApp.quit;
    return yield* Effect.interrupt;
  }
  // Chromium opens these caches at the first event-loop turn, before ready.
  yield* DesktopUserData.clearStaleGpuCaches({
    userDataPath,
    electronVersion: process.versions.electron,
  });

  const pendingSecondInstances: Array<readonly string[]> = [];
  let handleSecondInstance = (argv: readonly string[]) => {
    pendingSecondInstances.push(argv);
  };
  yield* electronApp.on("second-instance", (_event: unknown, argv: readonly string[]) => {
    handleSecondInstance(argv);
  });
  // macOS hands a launch link to open-url, which can fire before configure runs.
  const pendingOpenUrls: Array<string> = [];
  let handleOpenUrl = (url: string) => {
    if (!isAppLink(url)) return false;
    pendingOpenUrls.push(url);
    return true;
  };
  yield* electronApp.on("open-url", (event: { preventDefault: () => void }, url: string) => {
    if (handleOpenUrl(url)) event.preventDefault();
  });

  return DesktopDeepLinks.of({
    configure: Effect.gen(function* () {
      const electronWindow = yield* ElectronWindow.ElectronWindow;
      const webLinks = yield* DesktopWebLinks.DesktopWebLinks;
      const context = yield* Effect.context<ElectronWindow.ElectronWindow>();
      const runPromise = Effect.runPromiseWith(context);

      const openAppLink = (value: string | undefined) => {
        if (!isAppLink(value)) return false;
        void runPromise(webLinks.receive(value));
        return true;
      };
      const args = yield* HostProcess.Arguments;
      args.some(openAppLink);
      handleOpenUrl = openAppLink;
      for (const url of pendingOpenUrls.splice(0)) handleOpenUrl(url);
      handleSecondInstance = (argv) => {
        if (argv?.some(openAppLink)) return;
        void runPromise(
          Effect.gen(function* () {
            const mainWindow = yield* electronWindow.currentMainOrFirst;
            if (Option.isSome(mainWindow)) yield* electronWindow.reveal(mainWindow.value);
          }),
        );
      };
      for (const argv of pendingSecondInstances.splice(0)) handleSecondInstance(argv);
    }).pipe(Effect.withSpan("desktop.deepLinks.configure")),
  });
});

export const layer = Layer.effect(DesktopDeepLinks, make);
