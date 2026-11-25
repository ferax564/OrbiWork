import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { ORBI_PROJECT_FILE_NAME, type OrbiProjectFile } from "@orbiwork/contracts";
import { OrbiProjectFileFromJson } from "@orbiwork/shared/orbiProjectFile";

const decodeOrbiProjectFileJson = Schema.decodeEffect(OrbiProjectFileFromJson);

export class OrbiProjectFileLoadError extends Schema.TaggedError<OrbiProjectFileLoadError>()(
  "OrbiProjectFileLoadError",
  {
    operation: Schema.Literals(["read", "decode"]),
    workspaceRoot: Schema.String,
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} ${ORBI_PROJECT_FILE_NAME} at ${this.filePath}.`;
  }
}

export class OrbiProjectFileLoader extends Context.Service<
  OrbiProjectFileLoader,
  {
    /** Never fails; missing/unreadable/invalid files return none, with warnings for invalid files. */
    readonly load: (workspaceRoot: string) => Effect.Effect<Option.Option<OrbiProjectFile>>;
  }
>()("orbi/project/OrbiProjectFileLoader") {}

const logOrbiProjectFileLoadError = (error: OrbiProjectFileLoadError) =>
  Effect.logWarning(error).pipe(
    Effect.annotateLogs({
      operation: error.operation,
      workspaceRoot: error.workspaceRoot,
      filePath: error.filePath,
      errorTag: error._tag,
    }),
  );

/** @public */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const load: OrbiProjectFileLoader["Service"]["load"] = Effect.fn("OrbiProjectFileLoader.load")(
    function* (workspaceRoot) {
      const filePath = path.join(workspaceRoot, ORBI_PROJECT_FILE_NAME);
      const raw = yield* fileSystem.readFileString(filePath).pipe(
        Effect.asSome,
        Effect.catchTags({
          PlatformError: (error) =>
            error.reason._tag === "NotFound"
              ? Effect.succeed(Option.none<string>())
              : logOrbiProjectFileLoadError(
                  new OrbiProjectFileLoadError({
                    operation: "read",
                    workspaceRoot,
                    filePath,
                    cause: error,
                  }),
                ).pipe(Effect.as(Option.none<string>())),
        }),
      );
      if (Option.isNone(raw)) {
        return Option.none<OrbiProjectFile>();
      }
      return yield* decodeOrbiProjectFileJson(raw.value).pipe(
        Effect.asSome,
        Effect.catchTags({
          SchemaError: (error) =>
            logOrbiProjectFileLoadError(
              new OrbiProjectFileLoadError({
                operation: "decode",
                workspaceRoot,
                filePath,
                cause: error,
              }),
            ).pipe(Effect.as(Option.none<OrbiProjectFile>())),
        }),
      );
    },
  );

  return OrbiProjectFileLoader.of({ load });
});

export const layer = Layer.effect(OrbiProjectFileLoader, make);
