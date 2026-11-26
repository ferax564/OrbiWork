import type { UsageProviderKind } from "@orbiwork/contracts";
import type { TranscriptUsageFormat } from "@orbiwork/provider-core/server/usage";

import { claudeUsageFormat } from "../provider/Drivers/claudeUsage.ts";
import { codexUsageFormat } from "../provider/Drivers/codexUsage.ts";

export const TEST_FORMATS: Record<UsageProviderKind, TranscriptUsageFormat<unknown>> = {
  claude: claudeUsageFormat,
  codex: codexUsageFormat,
};

export const TEST_FORMAT_MAP = new Map<UsageProviderKind, TranscriptUsageFormat<unknown>>(
  Object.entries(TEST_FORMATS) as Array<[UsageProviderKind, TranscriptUsageFormat<unknown>]>,
);
