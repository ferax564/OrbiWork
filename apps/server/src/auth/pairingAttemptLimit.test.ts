import { describe, expect, it } from "vite-plus/test";

import { makePairingAttemptLimit } from "./pairingAttemptLimit.ts";

describe("makePairingAttemptLimit", () => {
  const limits = { windowMs: 1_000, perPeer: 2, maxPeers: 2 };

  it("blocks only the peer that guessed wrong, until its window ends", () => {
    const limit = makePairingAttemptLimit(limits);
    limit.recordFailure("a", 0);
    expect(limit.retryAfterMs("a", 100)).toBe(0);
    limit.recordFailure("a", 100);
    expect(limit.retryAfterMs("a", 400)).toBe(600);
    expect(limit.retryAfterMs("b", 400)).toBe(0);
    expect(limit.retryAfterMs("a", 1_000)).toBe(0);
  });

  it("stops tracking new peers past maxPeers and reuses expired slots", () => {
    const limit = makePairingAttemptLimit({ ...limits, perPeer: 1 });
    limit.recordFailure("a", 0);
    limit.recordFailure("b", 0);
    limit.recordFailure("c", 0);
    expect(limit.retryAfterMs("c", 0)).toBe(0);
    limit.recordFailure("d", 1_000);
    expect(limit.retryAfterMs("d", 1_000)).toBe(1_000);
  });
});
