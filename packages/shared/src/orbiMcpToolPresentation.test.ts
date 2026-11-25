import { describe, expect, it } from "vite-plus/test";

import {
  ORBI_MCP_TOOL_NAMES,
  resolveOrbiMcpSummaryAction,
  resolveOrbiMcpToolDefinition,
  resolveOrbiMcpToolPresentation,
} from "./orbiMcpToolPresentation.ts";

describe("resolveOrbiMcpToolPresentation", () => {
  it("recognizes every Orbi tool across provider prefixes and completion suffixes", () => {
    for (const tool of ORBI_MCP_TOOL_NAMES) {
      const presentation = resolveOrbiMcpToolPresentation(tool);
      for (const prefix of [
        "mcp__orbiwork__",
        "ORBIWORK.",
        "orbiwork.",
        "orbiwork-direct.",
        "mcp__orbiwork_direct__",
        "orbiwork/",
        "orbiwork:",
        "mcp_orbiwork_",
        "OrbiWork ",
        "orbiwork · ",
      ]) {
        expect(resolveOrbiMcpToolPresentation(`${prefix}${tool} completed`), tool).toEqual(
          presentation,
        );
      }
      expect(resolveOrbiMcpToolPresentation(`mcp__another-server__${tool}`), tool).toBeNull();
    }
  });

  it("matches OpenCode 2's per-thread server names, whose thread ids hold underscores", () => {
    expect(
      resolveOrbiMcpToolPresentation("orbiwork-thread_opencode2-adapter_delegate_task")
        ?.displayName,
    ).toBe("Delegate a child task");
    expect(
      resolveOrbiMcpToolPresentation("orbiwork-thread_opencode2-adapter_not_a_tool"),
    ).toBeNull();
  });
});

describe("resolveOrbiMcpToolDefinition", () => {
  it("labels an action tool call as the action it ran", () => {
    expect(
      resolveOrbiMcpToolDefinition("mcp__orbiwork__preview_act", { action: "type" })?.labels,
    ).toEqual(resolveOrbiMcpToolDefinition("preview_type")?.labels);
    expect(
      resolveOrbiMcpToolDefinition("orbi_thread_transfer", { action: "fork" })?.displayName,
    ).toBe(resolveOrbiMcpToolDefinition("orbi_thread_fork")?.displayName);
    expect(resolveOrbiMcpToolDefinition("preview_act", { action: "unknown" })?.labels[2]).toBe(
      "Used",
    );
  });
});

describe("resolveOrbiMcpSummaryAction", () => {
  it("summarizes an action tool by the action each call ran", () => {
    expect(resolveOrbiMcpSummaryAction("mcp__orbiwork__orbi_queue", { action: "list" })).toBe(
      "queue-list",
    );
    expect(resolveOrbiMcpSummaryAction("orbi_queue", { action: "edit" })).toBe("queue-edit");
    expect(resolveOrbiMcpSummaryAction("orbi_thread_transfer", { action: "status" })).toBe(
      "thread-transfers",
    );
    expect(resolveOrbiMcpSummaryAction("orbi_thread_configure", {})).toBe("thread-configuration");
    expect(resolveOrbiMcpSummaryAction("schedule_task", { scheduledTaskId: "task-1" })).toBe(
      "schedule-update",
    );
    expect(resolveOrbiMcpSummaryAction("delegate_task", { task: "x" })).toBe("delegate");
  });
});
