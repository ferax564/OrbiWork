interface Window {
  readonly startedAt: number;
  failures: number;
}

/**
 * Fixed-window count of failed pairing redemptions per socket peer. There is no shared cap, so one
 * peer's guesses never block another. Past `maxPeers` live entries a new peer goes uncounted.
 */
export function makePairingAttemptLimit(
  limits = { windowMs: 15 * 60_000, perPeer: 10, maxPeers: 1_000 },
) {
  const peers = new Map<string, Window>();

  const live = (window: Window | undefined, now: number) =>
    window !== undefined && now - window.startedAt < limits.windowMs ? window : undefined;

  return {
    /** Milliseconds until `peer` may try again, or 0 when it may try now. */
    retryAfterMs: (peer: string, now: number): number => {
      const current = live(peers.get(peer), now);
      return current !== undefined && current.failures >= limits.perPeer
        ? current.startedAt + limits.windowMs - now
        : 0;
    },

    recordFailure: (peer: string, now: number): void => {
      const current = live(peers.get(peer), now);
      if (current !== undefined) {
        current.failures += 1;
        return;
      }
      if (peers.size >= limits.maxPeers) {
        for (const [key, window] of peers) {
          if (live(window, now) === undefined) peers.delete(key);
        }
        if (peers.size >= limits.maxPeers) return;
      }
      peers.set(peer, { startedAt: now, failures: 1 });
    },
  };
}
