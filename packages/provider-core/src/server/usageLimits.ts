import type {
  ProviderUsageLimitsUpdate,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
} from "@orbiwork/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

const WINDOW_KIND_ORDER: Record<ServerProviderUsageWindow["kind"], number> = {
  session: 0,
  weekly: 1,
  monthly: 2,
  other: 3,
};

export function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function sortWindows(
  windows: Iterable<ServerProviderUsageWindow>,
): ReadonlyArray<ServerProviderUsageWindow> {
  return [...windows].toSorted(
    (left, right) =>
      WINDOW_KIND_ORDER[left.kind] - WINDOW_KIND_ORDER[right.kind] ||
      left.id.localeCompare(right.id),
  );
}

export function makeUsageLimits(input: {
  readonly checkedAt: string;
  readonly windows: Iterable<ServerProviderUsageWindow>;
}): ServerProviderUsageLimits {
  return { checkedAt: input.checkedAt, windows: sortWindows(input.windows) };
}

export function makeUnavailableUsageLimits(input: {
  readonly checkedAt: string;
  readonly reason: "unsupported" | "probeFailed";
  readonly message?: string;
}): ServerProviderUsageLimits {
  return {
    checkedAt: input.checkedAt,
    windows: [],
    unavailable: {
      reason: input.reason,
      ...(input.message ? { message: input.message } : {}),
    },
  };
}

export function applyUsageLimitsUpdate(input: {
  readonly previous: ServerProviderUsageLimits | undefined;
  readonly update: ProviderUsageLimitsUpdate;
  readonly checkedAt: string;
}): ServerProviderUsageLimits | undefined {
  const { previous, update } = input;
  if (update.windows.length === 0 || previous?.unavailable?.reason === "unsupported") {
    return previous;
  }
  const merged = new Map(previous?.windows.map((window) => [window.id, window] as const));
  // Codex repeats unchanged limits on token ticks; avoid allocating snapshots for no-ops.
  let changed = false;
  for (const window of update.windows) {
    const existing = merged.get(window.id);
    const next: ServerProviderUsageWindow = {
      ...window,
      usedPercent: clampPercent(window.usedPercent),
      ...(window.resetsAt === undefined && existing?.resetsAt !== undefined
        ? { resetsAt: existing.resetsAt }
        : {}),
      ...(window.windowDurationMins === undefined && existing?.windowDurationMins !== undefined
        ? { windowDurationMins: existing.windowDurationMins }
        : {}),
    };
    if (existing === undefined || !usageWindowEquals(existing, next)) {
      merged.set(window.id, next);
      changed = true;
    }
  }
  if (!changed && previous !== undefined) {
    return previous;
  }
  const unavailable =
    previous === undefined ? { reason: "probeFailed" as const } : previous.unavailable;
  return {
    ...makeUsageLimits({ checkedAt: input.checkedAt, windows: merged.values() }),
    ...(previous?.resetCredits !== undefined ? { resetCredits: previous.resetCredits } : {}),
    ...(previous?.zeroSpendCap ? { zeroSpendCap: true } : {}),
    ...(unavailable !== undefined ? { unavailable } : {}),
  };
}

function usageWindowEquals(a: ServerProviderUsageWindow, b: ServerProviderUsageWindow): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.label === b.label &&
    a.usedPercent === b.usedPercent &&
    (a.modelIds === b.modelIds ||
      (a.modelIds !== undefined &&
        b.modelIds !== undefined &&
        a.modelIds.length === b.modelIds.length &&
        a.modelIds.every((id, index) => id === b.modelIds?.[index]))) &&
    (a.providerIds === b.providerIds ||
      (a.providerIds !== undefined &&
        b.providerIds !== undefined &&
        a.providerIds.length === b.providerIds.length &&
        a.providerIds.every((id, index) => id === b.providerIds?.[index]))) &&
    a.resetsAt === b.resetsAt &&
    a.windowDurationMins === b.windowDurationMins
  );
}

export function resolveUsageLimitsAfterProbe(input: {
  readonly published: ServerProviderUsageLimits | undefined;
  readonly probed: ServerProviderUsageLimits | undefined;
}): ServerProviderUsageLimits | undefined {
  const { published, probed } = input;
  if (probed?.unavailable?.reason === "probeFailed" && published && !published.unavailable) {
    return published;
  }
  if (
    published &&
    probed &&
    !published.unavailable &&
    !probed.unavailable &&
    Date.parse(published.checkedAt) > Date.parse(probed.checkedAt)
  ) {
    return { ...probed, checkedAt: published.checkedAt, windows: published.windows };
  }
  return probed;
}

// Quota reads send the user's provider credentials to the provider, so they run only for a short
// while after the user asks for quota (opens Usage, refreshes providers, or a turn hits a usage
// limit), never from boot or health-check timers.
// shortcut: one process-wide window, not per-instance demand; upgrade if instances need separate gating.
const USAGE_LIMITS_REQUEST_WINDOW_MS = 2 * 60_000;
let usageLimitsRequestedAtMs: number | undefined;

/** Marks that the user asked for quota; reads in the next two minutes may contact providers. */
export const requestUsageLimits: Effect.Effect<void> = Effect.flatMap(
  Clock.currentTimeMillis,
  (now) =>
    Effect.sync(() => {
      usageLimitsRequestedAtMs = now;
    }),
);

let usageLimitReadsAlwaysAllowed = false;

/**
 * Tests only: `true` lets quota reads run without a request (for tests of the reads themselves);
 * `false` restores the gate and forgets earlier requests. Module state, so set it in beforeAll and
 * reset it in afterAll.
 */
export function setUsageLimitReadsAllowedForTests(allowed: boolean): void {
  usageLimitReadsAlwaysAllowed = allowed;
  if (!allowed) usageLimitsRequestedAtMs = undefined;
}

export const usageLimitsRequested: Effect.Effect<boolean> = Effect.map(
  Clock.currentTimeMillis,
  (now) =>
    usageLimitReadsAlwaysAllowed ||
    (usageLimitsRequestedAtMs !== undefined &&
      now >= usageLimitsRequestedAtMs &&
      now - usageLimitsRequestedAtMs < USAGE_LIMITS_REQUEST_WINDOW_MS),
);

/** Runs a quota read only after the user asked for quota; otherwise yields undefined (no new reading). */
export const whenUsageLimitsRequested = <A, E, R>(
  read: Effect.Effect<A, E, R>,
): Effect.Effect<A | undefined, E, R> =>
  Effect.flatMap(usageLimitsRequested, (requested) => (requested ? read : Effect.undefined));
