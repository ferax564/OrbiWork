import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { OrbiProjectFile } from "@orbiwork/contracts";

import { fromLenientJson } from "./schemaJson.ts";

export const OrbiProjectFileFromJson = fromLenientJson(OrbiProjectFile);

const decodeOrbiProjectFile = Schema.decodeExit(OrbiProjectFileFromJson);

export function parseOrbiProjectFile(contents: string): OrbiProjectFile | null {
  const decoded = decodeOrbiProjectFile(contents);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}
