import {
  DesktopUpdateActionResultSchema,
  DesktopUpdateChannelSchema,
  DesktopUpdateCheckResultSchema,
  DesktopUpdatePreferencesSchema,
  DesktopUpdateStateSchema,
} from "@orbiwork/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopAppSettings from "../../settings/DesktopAppSettings.ts";
import * as DesktopUpdates from "../../updates/DesktopUpdates.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const getUpdateState = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.UPDATE_GET_STATE_CHANNEL,
  payload: Schema.Void,
  result: DesktopUpdateStateSchema,
  handler: Effect.fn("desktop.ipc.updates.getState")(function* () {
    const updates = yield* DesktopUpdates.DesktopUpdates;
    return yield* updates.getState;
  }),
});

export const setUpdateChannel = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.UPDATE_SET_CHANNEL_CHANNEL,
  payload: Schema.Struct({
    channel: DesktopUpdateChannelSchema,
    minimumVersion: Schema.optional(Schema.String),
  }),
  result: DesktopUpdateStateSchema,
  handler: Effect.fn("desktop.ipc.updates.setChannel")(function* ({ channel, minimumVersion }) {
    const updates = yield* DesktopUpdates.DesktopUpdates;
    return yield* updates.setChannel(channel, { minimumVersion });
  }),
});

export const downloadUpdate = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.UPDATE_DOWNLOAD_CHANNEL,
  payload: Schema.Void,
  result: DesktopUpdateActionResultSchema,
  handler: Effect.fn("desktop.ipc.updates.download")(function* () {
    const updates = yield* DesktopUpdates.DesktopUpdates;
    return yield* updates.download;
  }),
});

export const installUpdate = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.UPDATE_INSTALL_CHANNEL,
  /** A version installs only that downloaded build, never one that replaced it. */
  payload: Schema.UndefinedOr(Schema.String),
  result: DesktopUpdateActionResultSchema,
  handler: Effect.fn("desktop.ipc.updates.install")(function* (expectedVersion) {
    const updates = yield* DesktopUpdates.DesktopUpdates;
    if (expectedVersion === undefined) return yield* updates.install;
    const { accepted, completed, state } = yield* updates.installPrepared(expectedVersion);
    return { accepted, completed, state };
  }),
});

export const checkForUpdate = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.UPDATE_CHECK_CHANNEL,
  payload: Schema.Void,
  result: DesktopUpdateCheckResultSchema,
  handler: Effect.fn("desktop.ipc.updates.check")(function* () {
    const updates = yield* DesktopUpdates.DesktopUpdates;
    return yield* updates.check("web-ui");
  }),
});

const toUpdatePreferences = (settings: DesktopAppSettings.DesktopSettings) => ({
  automaticUpdateChecks: settings.automaticUpdateChecks,
  remoteUpdatesAllowed: settings.remoteUpdatesAllowed,
});

export const getUpdatePreferences = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.UPDATE_GET_PREFERENCES_CHANNEL,
  payload: Schema.Void,
  result: DesktopUpdatePreferencesSchema,
  handler: Effect.fn("desktop.ipc.updates.getPreferences")(function* () {
    return toUpdatePreferences(yield* (yield* DesktopAppSettings.DesktopAppSettings).get);
  }),
});

// Main-window IPC only, so a remote client can never turn on its own permission to update.
export const setUpdatePreferences = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.UPDATE_SET_PREFERENCES_CHANNEL,
  payload: Schema.Struct({
    automaticUpdateChecks: Schema.optionalKey(Schema.Boolean),
    remoteUpdatesAllowed: Schema.optionalKey(Schema.Boolean),
  }),
  result: DesktopUpdatePreferencesSchema,
  handler: Effect.fn("desktop.ipc.updates.setPreferences")(function* (preferences) {
    const settings = yield* DesktopAppSettings.DesktopAppSettings;
    const { settings: next } = yield* settings.setUpdatePreferences(preferences);
    return toUpdatePreferences(next);
  }),
});
