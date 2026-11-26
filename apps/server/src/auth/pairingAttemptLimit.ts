interface Window {
  readonly startedAt: number;
  failures: number;
}

/**
 * Fixed-window count of failed pairing redemptions, per socket peer and in total. Memory stays
 * bounded: past `maxPeers`, an unseen peer counts only toward the global cap.
 */
export function makePairingAttemptLimit(
  limits = { windowMs: 15 * 60_000, perPeer: 10, global: 100, maxPeers: 1_000 },
) {
  const peers = new Map<string, Window>();
  let global: Window = { startedAt: 0, failures: 0 };

  const live = (window: Window | undefined, now: number) =>
    window !== undefined && now - window.startedAt < limits.windowMs ? window : undefined;

  const waitMs = (window: Window | undefined, cap: number, now: number) => {
    const current = live(window, now);
    return current !== undefined && current.failures >= cap
      ? current.startedAt + limits.windowMs - now
      : 0;
  };

  return {
    /** Milliseconds until `peer` may try again, or 0 when it may try now. */
    retryAfterMs: (peer: string, now: number): number =>
      Math.max(waitMs(peers.get(peer), limits.perPeer, now), waitMs(global, limits.global, now)),

    recordFailure: (peer: string, now: number): void => {
      global = live(global, now) ?? { startedAt: now, failures: 0 };
      global.failures += 1;
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
