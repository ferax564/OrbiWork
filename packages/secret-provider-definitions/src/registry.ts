import { makeSecretProviderDefinitionRegistry } from "@orbiwork/secret-provider-core/shared/definition";
import * as OnePassword from "@orbiwork/secret-provider-onepassword/shared/definition";

export const builtInSecretProviderDefinitions = makeSecretProviderDefinitionRegistry([
  OnePassword.definition,
]);
