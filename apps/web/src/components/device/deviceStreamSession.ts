import { createCanvasFrameSink } from "@orbiwork/client-runtime/device/frame";
import type { DuoControlState } from "@orbiwork/client-runtime/device/duo-control";
import {
  createDeviceStreamClient,
  type DeviceScreenSize,
  type DeviceStreamClient,
  type DeviceStreamStatus,
} from "@orbiwork/client-runtime/device/stream";
import type { DeviceHubAccess } from "@orbiwork/client-runtime/state/deviceHubAccess";
import type { DevicePlatform, EnvironmentId } from "@orbiwork/contracts";
import { Atom } from "effect/reactivity";

import { m } from "~/i18n/messages";
import { refreshDeviceHubAccess } from "~/state/device";

export interface DeviceStreamState {
  readonly status: DeviceStreamStatus;
  readonly detail: string | undefined;
  readonly screen: DeviceScreenSize | null;
  readonly mjpegUrl: string | null;
  readonly mjpegGeneration: number;
  readonly input: { readonly connected: boolean; readonly detail?: string };
  readonly duoControl: DuoControlState;
}

export interface DeviceStreamSession {
  readonly stream: DeviceStreamClient;
  /** The stream draws here; the view mounts it. */
  readonly canvas: HTMLCanvasElement;
  readonly reconnect: () => void;
  readonly state: DeviceStreamState;
}

export interface DeviceStreamKey {
  readonly environmentId: EnvironmentId;
  readonly hostId: string;
  readonly platform: DevicePlatform;
  readonly deviceId: string;
  readonly access: DeviceHubAccess;
  /** See `DeviceStreamTarget.serveSimOnly`. */
  readonly serveSimOnly: boolean;
  /** Each mounted view owns its own client: one canvas cannot be in two places. */
  readonly viewId: string;
}

export const IDLE_DEVICE_STREAM_STATE: DeviceStreamState = {
  status: "connecting",
  detail: undefined,
  screen: null,
  mjpegUrl: null,
  mjpegGeneration: 0,
  input: { connected: false },
  duoControl: { pending: false, requested: null, error: null },
};

export const deviceScreenKey = (environmentId: EnvironmentId, hostId: string, deviceId: string) =>
  `${environmentId}\u0000${hostId}\u0000${deviceId}`;

/**
 * The screen one view's stream last reported, null while that view streams nothing.
 * Keyed by view, not device: two views of one device stream independently, and one
 * ending must not clear the other's size. The mini player lays out its frame from it.
 */
export const deviceStreamScreenAtom = Atom.family((viewId: string) =>
  Atom.make<DeviceScreenSize | null>(null).pipe(Atom.withLabel(`device-stream-screen:${viewId}`)),
);

/** A device's video and input connection, live while a view reads it. */
export const deviceStreamSessionAtom = Atom.family((key: DeviceStreamKey) =>
  Atom.make((get): DeviceStreamSession => {
    const screenAtom = deviceStreamScreenAtom(key.viewId);
    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    let state = IDLE_DEVICE_STREAM_STATE;
    let session: DeviceStreamSession;
    const update = (patch: Partial<DeviceStreamState>) => {
      state = { ...state, ...patch };
      session = { ...session, state };
      get.setSelf(session);
    };
    const client = createDeviceStreamClient(
      {
        platform: key.platform,
        deviceId: key.deviceId,
        access: key.access,
        serveSimOnly: key.serveSimOnly,
      },
      createCanvasFrameSink(canvas),
      {
        onDuoControl: (duoControl) => update({ duoControl }),
        onStatus: (status, detail) => update({ status, detail }),
        onScreen: (screen) => {
          get.set(screenAtom, screen);
          update({ screen });
        },
        onUnauthorized: () => refreshDeviceHubAccess(key.environmentId),
        onMjpegFallback: (mjpegUrl) =>
          update({ mjpegUrl, mjpegGeneration: state.mjpegGeneration + 1 }),
        onCanvasVideo: () => update({ mjpegUrl: null }),
        onInputConnected: (connected, detail) =>
          update({ input: { connected, ...(detail ? { detail } : {}) } }),
      },
      m,
    );
    session = {
      stream: client,
      canvas,
      reconnect: () => {
        client.stop();
        client.start();
      },
      state,
    };
    get.addFinalizer(() => {
      client.stop();
      get.registry.set(screenAtom, null);
    });
    client.start();
    return session;
  }).pipe(Atom.withLabel(`device-stream:${key.platform}:${key.deviceId}`)),
);
