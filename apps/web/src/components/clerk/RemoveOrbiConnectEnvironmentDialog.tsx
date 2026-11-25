import { Discovery } from "@orbiwork/client-runtime/relay";
import type { EnvironmentId } from "@orbiwork/contracts";
import { T, useGT, Var } from "gt-react";
import { useState } from "react";

import { useRelayEnvironmentDiscovery } from "../../state/environments";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button, InlineButton } from "../ui/button";
import { useOrbiConnectAccountPage } from "./OrbiConnectAccountPages";

export function RemoveOrbiConnectEnvironmentDialog({
  environmentLabel,
  environmentId,
  onCancel,
  onConfirm,
}: {
  readonly environmentLabel: string | null;
  readonly environmentId: EnvironmentId | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const accountPage = useOrbiConnectAccountPage();
  const gt = useGT();
  const discovery = useRelayEnvironmentDiscovery();
  const registration = environmentId
    ? Discovery.relayEnvironmentRegistration(discovery, environmentId)
    : "unknown";
  const [shown, setShown] = useState({ label: environmentLabel, registration });
  if (
    environmentLabel !== null &&
    (environmentLabel !== shown.label || registration !== shown.registration)
  ) {
    setShown({ label: environmentLabel, registration });
  }
  const openAccountPage = accountPage.open;
  const accountPageLink = openAccountPage ? (
    <InlineButton
      onClick={() => {
        onCancel();
        openAccountPage();
      }}
    >
      <T>Orbi Connect settings</T>
    </InlineButton>
  ) : (
    gt("Orbi Connect settings")
  );

  return (
    <>
      <AlertDialog
        open={environmentLabel !== null}
        onOpenChange={(open) => {
          if (!open) onCancel();
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T>
                Remove <Var>{shown.label}</Var> from this device?
              </T>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <T>This forgets its pairing, credentials, and cached threads here.</T>
            </AlertDialogDescription>
            <AlertDialogDescription>
              {shown.registration === "registered" ? (
                <T>
                  It stays on your Orbi Connect account and keeps its host space. Deregister it in{" "}
                  <Var>{accountPageLink}</Var> to free it.
                </T>
              ) : shown.registration === "unregistered" ? (
                gt("It's no longer on your Orbi Connect account.")
              ) : (
                <T>
                  This doesn't change your Orbi Connect account. To deregister it there, use{" "}
                  <Var>{accountPageLink}</Var>.
                </T>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              <T>Cancel</T>
            </AlertDialogClose>
            <Button variant="destructive" onClick={onConfirm}>
              <T>Remove from this device</T>
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
      {accountPage.portals}
    </>
  );
}
