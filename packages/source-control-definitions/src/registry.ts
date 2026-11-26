import { makeSourceControlDefinitionRegistry } from "@orbiwork/source-control-core/shared/definition";
import * as GitHub from "@orbiwork/source-control-github/shared/definition";
import * as GitLab from "@orbiwork/source-control-gitlab/shared/definition";

/** GitHub comes first as the client default for unknown hosts. */
export const builtInSourceControlDefinitions = makeSourceControlDefinitionRegistry([
  GitHub.definition,
  GitLab.definition,
]);
