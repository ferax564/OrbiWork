import { thrownErrorMessage } from "@orbiwork/client-runtime/errors";
import { m } from "~/i18n/messages";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@orbiwork/client-runtime/state/runtime";
import { promptLinkAppPath } from "@orbiwork/shared/promptLinks";
import { readPairingAppLink, resolveRemotePairingTarget } from "@orbiwork/shared/remote";
import { useRouter } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { connectPairing } from "../../connection/onboarding";
import { isLocalEnvironmentDisabled } from "../../localEnvironment";
import { usePrimaryEnvironment } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../ui/toast";

/**
 * Receives the app's own links from the desktop shell: pairing links, which the user confirms
 * before the one-time token is spent, and prompt links, whose routes show the prompt for review
 * before anything runs. The shell hands over nothing else.
 */
export function DesktopWebLinkCoordinator() {
  const router = useRouter();
  const gt = useGT();
  const primaryEnvironment = usePrimaryEnvironment();
  const connectPairingEnvironment = useAtomCommand(connectPairing, { reportFailure: false });
  const queueRef = useRef(Promise.resolve());
  const pairedUrlsRef = useRef(new Set<string>());
  const webLinks = window.desktopBridge?.webLinks;
  // A sync IPC read; the setting only changes across a relaunch.
  const [localEnvironmentDisabled] = useState(isLocalEnvironmentDisabled);
  // With Local environment disabled there is no primary to wait for, so links run against the
  // saved remote environments instead of waiting forever.
  const ready =
    webLinks !== undefined &&
    (localEnvironmentDisabled ||
      (primaryEnvironment?.connection.phase === "connected" &&
        primaryEnvironment.serverConfig !== null));

  const reportPairingFailure = (error: unknown) =>
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: gt("Could not add backend"),
        description: thrownErrorMessage(error, m) ?? gt("Failed to add backend."),
      }),
    );

  // Any page can open a pairing link, so the user confirms the host before its one-time token is spent.
  const pairFromLink = async (pairingUrl: string) => {
    // A repeated click would only ask again and then fail on the spent one-time token.
    if (pairedUrlsRef.current.has(pairingUrl)) return;
    // The origin keeps the scheme visible, so a plain HTTP backend is not mistaken for HTTPS.
    let origin: string;
    try {
      origin = new URL(resolveRemotePairingTarget({ pairingUrl }).httpBaseUrl).origin;
    } catch (error) {
      reportPairingFailure(error);
      return;
    }
    const confirmed =
      (await requestConfirmDialog(gt("Add the backend at {origin}?", { origin }))) ?? false;
    if (!confirmed) return;
    const result = await connectPairingEnvironment({ pairingUrl });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) reportPairingFailure(squashAtomCommandFailure(result));
      return;
    }
    pairedUrlsRef.current.add(pairingUrl);
    toastManager.add({
      type: "success",
      title: gt("Backend added"),
      description: gt("The environment is saved and will reconnect on app startup."),
    });
  };

  const openLink = useEffectEvent(async (url: string) => {
    const pairingUrl = readPairingAppLink(url);
    if (pairingUrl !== null) {
      await pairFromLink(pairingUrl);
      return;
    }
    const appPath = promptLinkAppPath(url);
    if (appPath !== null) await router.navigate({ href: appPath });
  });

  const receiveLink = useEffectEvent((url: string) => {
    queueRef.current = queueRef.current.then(() => openLink(url)).catch(() => undefined);
  });

  // oxlint-disable-next-line orbiwork/no-unreasoned-state-sync -- subscribes to desktop web link opens over the bridge and marks the renderer ready
  useEffect(() => {
    if (!ready || webLinks === undefined) return;
    let subscribed = true;
    const unsubscribe = webLinks.onOpen(receiveLink);
    queueMicrotask(() => {
      if (subscribed) void webLinks.setReady(true).catch(() => undefined);
    });
    return () => {
      subscribed = false;
      void webLinks.setReady(false).catch(() => undefined);
      unsubscribe();
    };
  }, [ready, webLinks]);

  return null;
}
