import { describe, expect, it } from "vite-plus/test";
import { SecretProviderId, type ServerProviderModel } from "@orbiwork/contracts";

import {
  deriveProviderModelsForDisplay,
  nextProviderEnvironmentWithFieldSecret,
  nextProviderEnvironmentWithFieldValue,
} from "./ProviderInstanceCard";

describe("deriveProviderModelsForDisplay", () => {
  it("uses current config custom models instead of stale live custom rows", () => {
    const liveModels: ReadonlyArray<ServerProviderModel> = [
      {
        slug: "server-model",
        name: "Server Model",
        isCustom: false,
        capabilities: null,
      },
      {
        slug: "removed-custom",
        name: "Removed Custom",
        isCustom: true,
        capabilities: null,
      },
      {
        slug: "kept-custom",
        name: "Kept Custom",
        isCustom: true,
        capabilities: null,
      },
    ];

    expect(
      deriveProviderModelsForDisplay({
        liveModels,
        customModels: [{ slug: "kept-custom", name: "kept-custom", capabilities: null }],
      }).map((model) => model.slug),
    ).toEqual(["server-model", "kept-custom"]);
  });
});

describe("provider environment helpers", () => {
  const apiKeyField = {
    name: "ANTHROPIC_API_KEY",
    label: "Anthropic API key",
    sensitive: true,
  };

  it("writes dedicated provider secrets as sensitive environment variables", () => {
    expect(
      nextProviderEnvironmentWithFieldValue(
        [{ name: "EXTRA_FLAG", value: "1", sensitive: false }],
        apiKeyField,
        "  anthropic-key  ",
      ),
    ).toEqual([
      { name: "EXTRA_FLAG", value: "1", sensitive: false },
      { name: "ANTHROPIC_API_KEY", value: "anthropic-key", sensitive: true },
    ]);
  });

  it("replaces redacted provider secrets without preserving redaction markers", () => {
    expect(
      nextProviderEnvironmentWithFieldValue(
        [
          {
            name: "ANTHROPIC_API_KEY",
            value: "",
            sensitive: true,
            valueRedacted: true,
          },
        ],
        apiKeyField,
        "new-key",
      ),
    ).toEqual([{ name: "ANTHROPIC_API_KEY", value: "new-key", sensitive: true }]);
  });

  it("points a stored provider secret at a secret provider and drops the stored value", () => {
    const secret = {
      provider: SecretProviderId.make("personal"),
      reference: "op://Private/Anthropic/credential",
    };
    const stored = [{ name: "ANTHROPIC_API_KEY", value: "", sensitive: true, valueRedacted: true }];
    const referenced = nextProviderEnvironmentWithFieldSecret(stored, apiKeyField, secret);

    expect(referenced).toEqual([{ name: "ANTHROPIC_API_KEY", value: secret, sensitive: true }]);
    expect(nextProviderEnvironmentWithFieldSecret(referenced, apiKeyField, undefined)).toEqual([]);
  });

  it("applies the secure field default when replacing an existing non-sensitive value", () => {
    expect(
      nextProviderEnvironmentWithFieldValue(
        [{ name: "OPENAI_API_KEY", value: "old-key", sensitive: false }],
        {
          name: "OPENAI_API_KEY",
          label: "OpenAI API key",
        },
        "new-key",
      ),
    ).toEqual([{ name: "OPENAI_API_KEY", value: "new-key", sensitive: true }]);
  });
});
