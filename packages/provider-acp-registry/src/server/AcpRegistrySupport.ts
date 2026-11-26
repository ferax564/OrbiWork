import { AcpRegistryOperationError, AcpRegistryOperationErrorReason } from "@orbiwork/contracts";
import type { AcpRegistrySettings } from "../settings.ts";
import * as HostProcess from "@orbiwork/shared/HostProcess";
import { SpawnExecutableResolution } from "@orbiwork/shared/shell";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as AcpRegistryRuntimeCoordinator from "./AcpRegistryRuntimeCoordinator.ts";
import type * as AcpSessionRuntime from "@orbiwork/provider-acp/server/AcpSessionRuntime";

export const AcpRegistryErrorReason = AcpRegistryOperationErrorReason;
export type AcpRegistryErrorReason = typeof AcpRegistryErrorReason.Type;

export class AcpRegistryError extends Schema.TaggedError<AcpRegistryError>()("AcpRegistryError", {
  reason: AcpRegistryErrorReason,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}

export function toAcpRegistryOperationError(error: AcpRegistryError): AcpRegistryOperationError {
  return new AcpRegistryOperationError({
    reason: error.reason,
    message: error.detail,
    cause: error,
  });
}

export interface ResolvedAcpRegistryAgent {
  readonly spawn: AcpSessionRuntime.AcpSpawnInput;
}

export type AcpRegistryInspection =
  | { readonly status: "unconfigured" }
  | { readonly status: "missing_runner"; readonly version: null }
  | { readonly status: "ready"; readonly version: null };

export class AcpRegistryCatalog extends Context.Service<
  AcpRegistryCatalog,
  {
    readonly inspect: (
      settings: AcpRegistrySettings,
      environment?: NodeJS.ProcessEnv,
    ) => Effect.Effect<AcpRegistryInspection, AcpRegistryError>;
    readonly resolve: (
      settings: AcpRegistrySettings,
      cwd: string,
      environment?: NodeJS.ProcessEnv,
    ) => Effect.Effect<ResolvedAcpRegistryAgent, AcpRegistryError, Scope.Scope>;
  }
>()("@orbiwork/provider-acp-registry/server/AcpRegistrySupport/AcpRegistryCatalog") {}

export const makeAcpRegistryCatalog = Effect.fn("AcpRegistryCatalog.make")(function* () {
  const platform = yield* HostProcess.Platform;
  const hostEnvironment = yield* HostProcess.Environment;
  const executableResolver = yield* SpawnExecutableResolution;
  const resolveExecutable = (command: string, environment: NodeJS.ProcessEnv) =>
    Effect.promise(async () => executableResolver(command, platform, environment));

  const validateLocalExecutable = (command: string) =>
    platform === "win32" && /\.(?:cmd|bat)$/iu.test(command)
      ? Effect.fail(
          new AcpRegistryError({
            reason: "runner_unavailable",
            detail:
              "Local ACP commands launch without a shell. For a Windows batch wrapper, configure the underlying executable (for example node.exe) and pass the script path as an argument.",
          }),
        )
      : Effect.void;

  const inspect: AcpRegistryCatalog["Service"]["inspect"] = Effect.fn("AcpRegistryCatalog.inspect")(
    function* (settings, environment) {
      const command = settings.commandPath.trim();
      if (!command) return { status: "unconfigured" } as const;
      const executable = yield* resolveExecutable(command, environment ?? hostEnvironment);
      if (executable === undefined) return { status: "missing_runner", version: null } as const;
      yield* validateLocalExecutable(executable);
      return { status: "ready", version: null } as const;
    },
  );

  const resolve: AcpRegistryCatalog["Service"]["resolve"] = Effect.fn("AcpRegistryCatalog.resolve")(
    function* (settings, cwd, environment) {
      const executable = settings.commandPath.trim();
      if (!executable) {
        return yield* new AcpRegistryError({
          reason: "agent_not_configured",
          detail: "ACP agent requires an executable.",
        });
      }
      const env = environment ?? hostEnvironment;
      const command = yield* resolveExecutable(executable, env);
      if (command === undefined) {
        return yield* new AcpRegistryError({
          reason: "runner_unavailable",
          detail: "ACP agent executable is not available on this environment's PATH.",
        });
      }
      yield* validateLocalExecutable(command);
      return { spawn: { command, args: settings.commandArgs, cwd, env, shell: false } };
    },
  );

  return AcpRegistryCatalog.of({ inspect, resolve });
});

export const layer = Layer.merge(
  Layer.effect(AcpRegistryCatalog, makeAcpRegistryCatalog()),
  AcpRegistryRuntimeCoordinator.layer,
);
