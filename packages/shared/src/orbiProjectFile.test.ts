import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { parseOrbiProjectFile, OrbiProjectFileFromJson } from "./orbiProjectFile.ts";

const decodeJson = Schema.decodeUnknownSync(OrbiProjectFileFromJson);

describe("OrbiProjectFileFromJson", () => {
  it("decodes lenient JSONC with comments and trailing commas", () => {
    const decoded = decodeJson(`{
      // team scripts
      "iconPath": "assets/logo.svg",
      "scripts": [
        { "name": "Dev", "command": "pnpm dev", "stopOnSettle": true, },
      ],
    }`);

    expect(decoded.iconPath).toBe("assets/logo.svg");
    expect(decoded.scripts?.[0]).toEqual({ name: "Dev", command: "pnpm dev", stopOnSettle: true });
  });
});

describe("parseOrbiProjectFile", () => {
  it("reads project defaults from JSONC with a URL in a block comment", () => {
    expect(
      parseOrbiProjectFile(`{
        /* See https://orbiwork.invalid/schema/orbi.json */
        "defaultThreadEnvMode": "worktree"
      }`),
    ).toEqual({ defaultThreadEnvMode: "worktree" });
  });
});
