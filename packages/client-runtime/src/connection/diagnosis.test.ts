import { EnvironmentAuthInvalidError } from "@orbiwork/contracts";
import { describe, expect, it } from "@effect/vitest";

import { connectionDiagnosisText, presentConnectionDiagnosis } from "./diagnosis.ts";
import { mapRemoteDpopEnvironmentError, mapRemoteEnvironmentError } from "./errors.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  ConnectionBlockedError,
  type ConnectionAttemptError,
  type SupervisorConnectionState,
} from "./model.ts";
import { RemoteEnvironmentAuthFetchError } from "../rpc/http.ts";

const backoff = (lastFailure: ConnectionAttemptError): SupervisorConnectionState => ({
  ...AVAILABLE_CONNECTION_STATE,
  desired: true,
  network: "online",
  phase: "backoff",
  attempt: 3,
  lastFailure,
  retryAt: Date.UTC(2026, 9, 19, 12, 0, 30),
});

const diagnose = (state: SupervisorConnectionState) =>
  presentConnectionDiagnosis({ hostLabel: "Mac mini", state });

const results = (state: SupervisorConnectionState) =>
  diagnose(state)?.hops.map((hop) => `${hop.hop}:${hop.result}`);

const unreachable = () =>
  mapRemoteEnvironmentError(
    new RemoteEnvironmentAuthFetchError({ message: "Failed to fetch", cause: new TypeError() }),
  );

describe("presentConnectionDiagnosis", () => {
  it("returns null while nothing has failed", () => {
    expect(diagnose(AVAILABLE_CONNECTION_STATE)).toBeNull();
  });

  it("names OrbiWork on the host when a direct address does not answer", () => {
    const diagnosis = diagnose(backoff(unreachable()));
    expect(diagnosis?.headline).toBe("OrbiWork on Mac mini did not answer");
    expect(results(backoff(unreachable()))).toEqual(["device:ok", "server:failed"]);
    expect(diagnosis?.steps.join(" ")).toContain("Make sure OrbiWork is running on Mac mini.");
  });

  it("reports this device as offline before any other hop", () => {
    const state = { ...backoff(unreachable()), network: "offline" as const };
    expect(diagnose(state)?.headline).toBe("This device is offline");
    expect(results(state)?.[0]).toBe("device:failed");
  });

  it("names a clock skew from a DPoP time-window refusal", () => {
    const failure = mapRemoteDpopEnvironmentError(
      new EnvironmentAuthInvalidError({
        code: "auth_invalid",
        reason: "invalid_credential",
        dpopFailureReason: "time_window",
        traceId: "trace-1",
      }),
    );
    const diagnosis = diagnose(backoff(failure));
    expect(diagnosis?.headline).toBe("This device's clock is off");
    expect(diagnosis?.facts).toContainEqual(["Cause", "clock_skew"]);
  });

  it("tells a host that refused this device's login to sign in again, not to start OrbiWork", () => {
    const failure = mapRemoteEnvironmentError(
      new EnvironmentAuthInvalidError({
        code: "auth_invalid",
        reason: "invalid_credential",
        traceId: "trace-1",
      }),
    );
    const steps = diagnose(backoff(failure))?.steps.join(" ");
    expect(steps).not.toContain("Make sure OrbiWork is running");
    expect(steps).toMatch(/pair|sign in/i);
  });

  it("does not report hops as working when the failure names none", () => {
    const failure = new ConnectionBlockedError({
      reason: "authentication",
      detail: "Sign in again to authorize the environment.",
    });
    expect(results(backoff(failure))).not.toContainEqual(expect.stringMatching(/:ok$/));
  });

  it("writes one plain-text block without Connect links", () => {
    const diagnosis = diagnose(backoff(unreachable()));
    const text = connectionDiagnosisText("Mac mini", diagnosis!);
    expect(text).toContain("OrbiWork on Mac mini: FAILED");
    expect(text).not.toMatch(/Orbi Connect|More info/);
  });
});
