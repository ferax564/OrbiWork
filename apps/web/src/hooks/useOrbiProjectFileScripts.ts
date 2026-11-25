import {
  ORBI_PROJECT_FILE_NAME,
  type EnvironmentId,
  type OrbiProjectFile,
  type OrbiProjectFileScript,
} from "@orbiwork/contracts";
import { parseOrbiProjectFile } from "@orbiwork/shared/orbiProjectFile";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const NO_SCRIPTS: ReadonlyArray<OrbiProjectFileScript> = [];

export interface OrbiProjectFileState {
  status: "loading" | "missing" | "invalid" | "valid";
  file: OrbiProjectFile | null;
  scripts: ReadonlyArray<OrbiProjectFileScript>;
}

export function useOrbiProjectFileState(
  environmentId: EnvironmentId,
  cwd: string | null,
): OrbiProjectFileState {
  const query = useProjectFileQuery(environmentId, cwd ?? "", ORBI_PROJECT_FILE_NAME, cwd !== null);
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  const isPending = query.isPending;
  if (contents === null) {
    return {
      status: isPending ? "loading" : "missing",
      file: null,
      scripts: NO_SCRIPTS,
    } as const;
  }
  const file = parseOrbiProjectFile(contents);
  if (file === null) {
    return { status: "invalid", file: null, scripts: NO_SCRIPTS } as const;
  }
  return { status: "valid", file, scripts: file.scripts ?? NO_SCRIPTS } as const;
}

export function useOrbiProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<OrbiProjectFileScript> {
  return useOrbiProjectFileState(environmentId, cwd).scripts;
}
