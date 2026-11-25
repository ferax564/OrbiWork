import {
  ORBI_PROJECT_FILE_NAME,
  type EnvironmentId,
  type ProjectReadFileResult,
  type OrbiProjectFile,
} from "@orbiwork/contracts";
import { parseOrbiProjectFile } from "@orbiwork/shared/orbiProjectFile";
import { executeAtomQuery } from "@orbiwork/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";

import {
  getProjectFileQueryAtom,
  resolveProjectFileQueryData,
} from "~/components/files/projectFilesQueryState";
import { appAtomRegistry } from "~/rpc/atomRegistry";

function toOrbiProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
  result: ProjectReadFileResult | null,
): OrbiProjectFile | null {
  const data = resolveProjectFileQueryData(
    environmentId,
    workspaceRoot,
    ORBI_PROJECT_FILE_NAME,
    result,
  );
  if (data === null || data.exists === false || data.truncated) return null;
  return parseOrbiProjectFile(data.contents);
}

export async function readOrbiProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): Promise<OrbiProjectFile | null> {
  const result = await executeAtomQuery(
    appAtomRegistry,
    getProjectFileQueryAtom(environmentId, workspaceRoot, ORBI_PROJECT_FILE_NAME),
    { reportDefect: false, reportFailure: false },
  );
  return toOrbiProjectFile(
    environmentId,
    workspaceRoot,
    result._tag === "Success" ? result.value : null,
  );
}

/** The project's orbi.json from an earlier read, or `undefined` when none has loaded yet. */
export function peekOrbiProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): OrbiProjectFile | null | undefined {
  const result = appAtomRegistry.get(
    getProjectFileQueryAtom(environmentId, workspaceRoot, ORBI_PROJECT_FILE_NAME),
  );
  return AsyncResult.isSuccess(result)
    ? toOrbiProjectFile(environmentId, workspaceRoot, result.value)
    : undefined;
}
