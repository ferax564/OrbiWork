import {
  threadRuntimeCanArchive,
  type ThreadRuntimeSummary,
} from "@orbiwork/client-runtime/state/models";

export function threadCanArchive(runtime: ThreadRuntimeSummary | null | undefined): boolean {
  return threadRuntimeCanArchive(runtime);
}
