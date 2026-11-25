import * as Option from "effect/Option";

export type JoinPath = (first: string, ...segments: string[]) => string;

function normalizeConfiguredBaseDir(orbiHome: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(orbiHome)) {
    return Option.none();
  }
  const trimmed = orbiHome.value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly orbiHome: Option.Option<string>;
}): string {
  return Option.getOrElse(normalizeConfiguredBaseDir(input.orbiHome), () =>
    input.joinPath(input.homeDirectory, ".orbi"),
  );
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly orbiHome: Option.Option<string>;
}): string {
  const useDevSubdir =
    input.isDevelopment && Option.isNone(normalizeConfiguredBaseDir(input.orbiHome));
  return input.joinPath(input.baseDir, useDevSubdir ? "dev" : "userdata");
}
