import { assert, it } from "@effect/vitest";

import {
  repositoryPathFromRemoteUrl,
  transportSafeSourceControlErrorValue,
} from "./SourceControlProvider.ts";

it("removes URL credentials, query parameters, and fragments from error transport values", () => {
  assert.strictEqual(
    transportSafeSourceControlErrorValue(
      "https://user:secret@example.test/org/repo/pull/42?token=secret#discussion",
    ),
    "https://example.test/org/repo/pull/42",
  );
});

it.each([
  ["git@github.com:OrbiWork/orbiwork.git", "OrbiWork/orbiwork"],
  ["github.com:OrbiWork/orbiwork.git", "OrbiWork/orbiwork"],
  ["gitlab.com:OrbiWork/platform/orbiwork", "OrbiWork/platform/orbiwork"],
  ["https://github.com/OrbiWork/orbiwork.git", "OrbiWork/orbiwork"],
  ["https://github.com/OrbiWork/orbiwork.git?view=compact", "OrbiWork/orbiwork"],
  ["https://github.com/OrbiWork/orbiwork.git#section", "OrbiWork/orbiwork"],
  ["C:/repos/orbiwork", null],
])("reads the repository path of %s", (remoteUrl, expected) => {
  assert.strictEqual(repositoryPathFromRemoteUrl(remoteUrl), expected);
});
