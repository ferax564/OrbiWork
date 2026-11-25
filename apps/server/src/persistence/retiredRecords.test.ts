import { isKnownOrchestrationV2EventType, OrchestrationV2TurnItemJson } from "@orbiwork/contracts";
import * as Schema from "effect/Schema";
import { assert, it } from "@effect/vitest";

import { keptEventType, keptTurnItem } from "./retiredRecords.ts";

const decodeItem = Schema.decodeUnknownSync(OrchestrationV2TurnItemJson);

// A feedback card as an older server stored it.
const feedbackCard = (status: string, feedbackStatus: string) => ({
  id: "turn-item:feedback",
  threadId: "thread:old",
  runId: "run:old",
  nodeId: "node:old",
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 3,
  status,
  title: "Feedback for the Orbi team",
  startedAt: "2026-01-05T00:00:00.000Z",
  completedAt: null,
  updatedAt: "2026-01-05T00:00:00.000Z",
  type: "feedback_request",
  preview: {
    kind: "bug",
    subject: "orbi_thread",
    expected: "a",
    actual: "b",
    workaround: "",
    trace: null,
  },
  feedbackStatus,
});

it("reads a stored feedback card as a finished tool call", () => {
  for (const [status, kept] of [
    ["waiting", "cancelled"],
    ["completed", "completed"],
  ] as const) {
    const item = decodeItem(keptTurnItem(feedbackCard(status, "pending")));
    assert.equal(item.type, "dynamic_tool");
    assert.equal(item.status, kept);
    assert.equal(item.ordinal, 3);
    if (item.type === "dynamic_tool") {
      assert.equal(item.toolName, "orbi_feedback");
      assert.deepInclude(item.input as object, { subject: "orbi_thread" });
    }
    assert.notProperty(item, "feedbackStatus");
  }
});

it("leaves kept items and event types as they are", () => {
  const other = { type: "assistant_message", text: "hi" };
  assert.strictEqual(keptTurnItem(other), other);
  assert.equal(keptEventType("turn-item.updated"), "turn-item.updated");
});

it("reads a guest share update as the thread metadata change it carried", () => {
  assert.isFalse(isKnownOrchestrationV2EventType("thread.guest-share-updated"));
  assert.isTrue(isKnownOrchestrationV2EventType(keptEventType("thread.guest-share-updated")));
});
