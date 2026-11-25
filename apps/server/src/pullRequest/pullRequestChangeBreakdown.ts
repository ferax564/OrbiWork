import type { PullRequestChangeBreakdown } from "@orbiwork/contracts";
import { summarizeChangedFiles } from "@orbiwork/shared/changedFileKind";
import type { ProviderFileStats } from "@orbiwork/source-control-core/server/PullRequestProvider";

export function toChangeBreakdown(stats: ProviderFileStats): PullRequestChangeBreakdown {
  if (stats.truncated) return null;
  return summarizeChangedFiles(stats.files);
}
