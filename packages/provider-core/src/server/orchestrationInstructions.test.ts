import { assert, describe, it } from "@effect/vitest";

import {
  ORBIWORK_DEVICE_TOOL_INSTRUCTIONS,
  ORBIWORK_DEVICE_TOOL_INSTRUCTIONS_WITH_TOOL_SEARCH,
  ORBIWORK_ORCHESTRATION_INSTRUCTIONS,
  orbiAcpPromptWithInstructions,
  orbiOrchestrationPrompt,
  orbiOrchestrationSystemPrompt,
} from "./orchestrationInstructions.ts";

describe("Orbi device instructions", () => {
  it("route device work through device_open and give Claude the line that loads the tools", () => {
    for (const intent of ["`device_list`", "`device_open`", "`agent-device`", "ssh", "`hostId`"]) {
      assert.include(ORBIWORK_DEVICE_TOOL_INSTRUCTIONS, intent);
    }
    assert.notInclude(ORBIWORK_DEVICE_TOOL_INSTRUCTIONS, "ToolSearch");
    const loadLine =
      " Load them with ToolSearch `select:mcp__orbiwork__device_list,mcp__orbiwork__device_open,mcp__orbiwork__device_screenshot,mcp__orbiwork__device_close`.";
    assert.include(ORBIWORK_DEVICE_TOOL_INSTRUCTIONS_WITH_TOOL_SEARCH, loadLine);
    assert.equal(
      ORBIWORK_DEVICE_TOOL_INSTRUCTIONS_WITH_TOOL_SEARCH.replace(loadLine, ""),
      ORBIWORK_DEVICE_TOOL_INSTRUCTIONS,
    );
  });

  it("open the app before the returned command's snapshots, screenshots and input", () => {
    assert.include(
      ORBIWORK_DEVICE_TOOL_INSTRUCTIONS,
      "its snapshots, screenshots and input need `open <app>` first,",
    );
  });

  it("keep the failure rule from taking over or closing a session another thread holds", () => {
    // agent-device's DEVICE_IN_USE advice is to rerun with the owner's --session or close it first.
    assert.include(
      ORBIWORK_DEVICE_TOOL_INSTRUCTIONS,
      "follow its advice once, but never reuse or close another session; if it still fails,",
    );
  });

  it("reach OpenCode and Cursor only when the session holds device access", () => {
    assert.include(orbiOrchestrationSystemPrompt(true, true), ORBIWORK_DEVICE_TOOL_INSTRUCTIONS);
    assert.notInclude(orbiOrchestrationSystemPrompt(true, false), "## OrbiWork devices");
    assert.isUndefined(orbiOrchestrationSystemPrompt(false, true));

    const firstRun = (hasDeviceTools: boolean) =>
      orbiOrchestrationPrompt({
        prompt: "Check the login screen.",
        hasOrbiMcp: true,
        hasDeviceTools,
        orchestrationDelivered: false,
        deviceInstructionsDelivered: false,
      });
    assert.include(firstRun(true), ORBIWORK_DEVICE_TOOL_INSTRUCTIONS);
    assert.notInclude(firstRun(false), "## OrbiWork devices");

    const laterRun = (deviceInstructionsDelivered: boolean) =>
      orbiOrchestrationPrompt({
        prompt: "Check the login screen.",
        hasOrbiMcp: true,
        hasDeviceTools: true,
        orchestrationDelivered: true,
        deviceInstructionsDelivered,
      });
    assert.include(laterRun(false), ORBIWORK_DEVICE_TOOL_INSTRUCTIONS);
    assert.notInclude(laterRun(false), ORBIWORK_ORCHESTRATION_INSTRUCTIONS.trim());
    assert.equal(laterRun(true), "Check the login screen.");

    // A provider's own guidance reaches a conversation that already had the rest.
    const providerRun = (providerInstructionsDelivered: boolean) =>
      orbiOrchestrationPrompt({
        prompt: "Check the login screen.",
        hasOrbiMcp: true,
        hasDeviceTools: false,
        orchestrationDelivered: true,
        deviceInstructionsDelivered: false,
        providerInstructions: "Mark awaited shells.",
        providerInstructionsDelivered,
      });
    assert.include(providerRun(false), "Mark awaited shells.");
    assert.notInclude(providerRun(false), ORBIWORK_ORCHESTRATION_INSTRUCTIONS.trim());
    assert.equal(providerRun(true), "Check the login screen.");
  });

  it("reach ACP agents again when device access changes mid-thread", () => {
    const state = { interactionMode: "default", hasOrbiMcp: true, hasDeviceTools: false } as const;
    const withDevices = orbiAcpPromptWithInstructions({
      prompt: "Check the login screen.",
      state: { ...state, hasDeviceTools: true },
      previousState: state,
    });
    assert.include(withDevices, ORBIWORK_DEVICE_TOOL_INSTRUCTIONS);
    assert.equal(
      orbiAcpPromptWithInstructions({ prompt: "Again.", state, previousState: state }),
      "Again.",
    );
    assert.notInclude(
      orbiAcpPromptWithInstructions({ prompt: "Hi.", state }),
      "## OrbiWork devices",
    );
  });
});
