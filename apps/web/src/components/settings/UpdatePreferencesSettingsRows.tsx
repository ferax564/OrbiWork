import type { DesktopUpdatePreferences } from "@orbiwork/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import { useGT } from "gt-react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useEnvironmentQuery } from "~/state/query";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

class UpdatePreferencesLoadError extends Schema.TaggedError<UpdatePreferencesLoadError>()(
  "UpdatePreferencesLoadError",
  { cause: Schema.Defect() },
) {}

const updatePreferencesAtom = Atom.make(
  Effect.tryPromise({
    try: () => window.desktopBridge!.getUpdatePreferences(),
    catch: (cause) => new UpdatePreferencesLoadError({ cause }),
  }),
).pipe(
  Atom.keepAlive,
  Atom.swr({ staleTime: 30_000, revalidateOnMount: true }),
  Atom.withLabel("desktop:update-preferences:load"),
);

/** The desktop's update switches; its main process stores and enforces them. */
export function UpdatePreferencesSettingsRows() {
  const setting = useSearchableSetting();
  const gt = useGT();
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  const preferences = useEnvironmentQuery(bridge ? updatePreferencesAtom : null).data ?? null;

  const update = (change: Partial<DesktopUpdatePreferences>) => {
    void bridge
      ?.setUpdatePreferences(change)
      .then(() => appAtomRegistry.refresh(updatePreferencesAtom))
      .catch(() => {
        toastManager.add(
          stackedThreadToast({ type: "error", title: gt("Could not save the update setting") }),
        );
      });
  };

  return (
    <>
      <SettingsRow
        {...setting("automatic-update-checks")}
        description={gt(
          "Looks for a new release shortly after launch and every four hours. Check for Updates works either way.",
        )}
        control={
          <Switch
            checked={preferences?.automaticUpdateChecks ?? false}
            disabled={preferences === null}
            onCheckedChange={(checked) => update({ automaticUpdateChecks: checked })}
            aria-label={gt("Check for updates automatically")}
          />
        }
      />
      <SettingsRow
        {...setting("remote-updates")}
        description={gt(
          "Lets paired devices switch this app's update track, download and install updates, and restart it.",
        )}
        control={
          <Switch
            checked={preferences?.remoteUpdatesAllowed ?? false}
            disabled={preferences === null}
            onCheckedChange={(checked) => update({ remoteUpdatesAllowed: checked })}
            aria-label={gt("Allow remote updates")}
          />
        }
      />
    </>
  );
}
