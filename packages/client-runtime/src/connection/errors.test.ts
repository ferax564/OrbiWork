import { EnvironmentAuthInvalidError } from "@orbiwork/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  DPOP_UNKNOWN_HINT,
  isHostCredentialRefusal,
  mapRemoteDpopEnvironmentError,
} from "./errors.ts";
import { RemoteEnvironmentAuthFetchError, RemoteEnvironmentAuthTimeoutError } from "../rpc/http.ts";

describe("mapRemoteDpopEnvironmentError", () => {
  it.each([
    new RemoteEnvironmentAuthFetchError({
      message: "Failed to fetch remote environment endpoint.",
      cause: new TypeError("Failed to fetch"),
    }),
    new RemoteEnvironmentAuthTimeoutError({
      requestUrl: "https://environment.example.test",
      timeoutMs: 10_000,
    }),
  ])("places an unreachable host on the server hop: $_tag", (error) => {
    const mapped = mapRemoteDpopEnvironmentError(error);
    expect(mapped).toMatchObject({
      _tag: "ConnectionTransientError",
      detail: error.message,
      hop: "server",
    });
  });

  it("presents clock skew as one possible cause for a generic DPoP refusal", () => {
    const mapped = mapRemoteDpopEnvironmentError(
      new EnvironmentAuthInvalidError({
        code: "auth_invalid",
        reason: "invalid_credential",
        traceId: "trace-1",
      }),
    );
    expect(mapped).toMatchObject({
      _tag: "ConnectionBlockedError",
      reason: "authentication",
      detail: `The environment credential is invalid. ${DPOP_UNKNOWN_HINT}`,
      traceId: "trace-1",
    });
    expect(isHostCredentialRefusal(mapped)).toBe(true);
  });

  it("keeps a direct host's clock refusal apart from a refused pairing", () => {
    const mapped = mapRemoteDpopEnvironmentError(
      new EnvironmentAuthInvalidError({
        code: "auth_invalid",
        reason: "invalid_credential",
        dpopFailureReason: "time_window",
        traceId: "trace-clock",
      }),
    );
    expect(mapped).toMatchObject({ hop: "server", failureCause: "clock_skew" });
    expect(isHostCredentialRefusal(mapped)).toBe(false);
  });
});
