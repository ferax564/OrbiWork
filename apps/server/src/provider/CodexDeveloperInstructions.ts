import type { V2TurnStartParams__AdditionalContextEntry } from "effect-codex-app-server/schema";
import { buildRuntimeInstructions } from "@orbiwork/provider-core/server/runtimeInstructions";

import {
  ORBIWORK_BROWSER_TOOL_INSTRUCTIONS,
  ORBIWORK_DEVICE_TOOL_INSTRUCTIONS,
  ORBIWORK_ORCHESTRATION_SECTIONS,
} from "@orbiwork/provider-core/server/orchestrationInstructions";

/** Codex silently truncates additionalContext values over 1,000 tokens, counted as UTF-8 bytes / 4. */
export const CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES = 4_000;

export interface OrbiWorkToolAvailability {
  readonly browser: boolean;
  readonly device: boolean;
}

const normalizeAvailability = (
  availability: boolean | OrbiWorkToolAvailability,
): OrbiWorkToolAvailability =>
  typeof availability === "boolean" ? { browser: availability, device: false } : availability;

/** Instructions for unavailable tools would steer the model away from its remaining automation. */
const toolInstructions = (availability: boolean | OrbiWorkToolAvailability): string => {
  const tools = normalizeAvailability(availability);
  return [
    tools.browser ? ORBIWORK_BROWSER_TOOL_INSTRUCTIONS : "",
    tools.device ? ORBIWORK_DEVICE_TOOL_INSTRUCTIONS : "",
  ]
    .filter(Boolean)
    .join("\n\n");
};

export interface CodexRuntimeInfo {
  readonly model: string;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
}

/** Keep this outside collaboration mode; model-catalog mode text overrides client developer_instructions. */
export function buildCodexAdditionalContext(
  runtime: CodexRuntimeInfo,
  toolsAvailable: boolean | OrbiWorkToolAvailability = true,
): Record<string, V2TurnStartParams__AdditionalContextEntry> {
  const tools = toolInstructions(toolsAvailable);
  // Split values to fit per-entry caps; number keys because Codex emits them in key order.
  return {
    ...Object.fromEntries(
      ORBIWORK_ORCHESTRATION_SECTIONS.map((section, index) => [
        `orbiwork_orchestration_${String(index + 1).padStart(2, "0")}`,
        { kind: "application" as const, value: section },
      ]),
    ),
    orbiwork_runtime: {
      kind: "application",
      value: buildRuntimeInstructions({ harness: "Codex", ...runtime }),
    },
    ...(tools ? { orbiwork_tools: { kind: "application", value: tools } } : {}),
  };
}
