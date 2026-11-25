/**
 * Guest links and agent feedback were removed, but older databases still hold their events and
 * turn items. Reads map those rows to the kept shape closest to them, so they never fail to decode.
 */
const RETIRED_EVENT_TYPES: Readonly<Record<string, string>> = {
  // Its payload is the whole thread, as for every thread metadata change.
  "thread.guest-share-updated": "thread.metadata-updated",
};

export const keptEventType = (type: string): string => RETIRED_EVENT_TYPES[type] ?? type;

/** A feedback report card reads as the finished tool call that asked for it. */
export function keptTurnItem(item: unknown): unknown {
  if (typeof item !== "object" || item === null) return item;
  const record = item as Record<string, unknown>;
  if (record.type !== "feedback_request") return item;
  const { preview, conversationTrace: _trace, feedbackStatus: _status, ...base } = record;
  return {
    ...base,
    type: "dynamic_tool",
    toolName: "orbi_feedback",
    input: preview ?? null,
    // An unanswered card can never be answered now.
    status: base.status === "waiting" ? "cancelled" : base.status,
  };
}
