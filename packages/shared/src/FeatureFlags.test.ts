import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as FeatureFlags from "./FeatureFlags.ts";

it.effect("resolves ORBIWORK_FEATURE_FLAGS lists", () =>
  Effect.gen(function* () {
    const cases: ReadonlyArray<
      readonly [string | undefined, Partial<FeatureFlags.FeatureFlagValues>]
    > = [
      [undefined, {}],
      [" secret_providers=1 , tanstack_source ", { secretProviders: true }],
      [
        "secret_providers=0,github_app_client_id=Iv23=x",
        { githubAppClientId: Option.some("Iv23=x") },
      ],
      ["secret_providers,typo_flag", { secretProviders: true }],
      // One bad value turns every flag off rather than failing startup.
      ["github_app_client_id=x,secret_providers=maybe", {}],
    ];
    for (const [list, expected] of cases) {
      assert.deepStrictEqual(yield* FeatureFlags.resolve(list), {
        secretProviders: false,
        githubAppClientId: Option.none(),
        ...expected,
      });
    }
  }),
);
