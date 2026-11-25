import type { DesktopSshEnvironmentTarget } from "@orbiwork/contracts";
import * as HostProcess from "@orbiwork/shared/HostProcess";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { SshPasswordPromptError } from "./errors.ts";

export interface SshPasswordRequest {
  readonly destination: string;
  readonly username: string | null;
  readonly prompt: string;
  readonly attempt: number;
}

interface SshAskpassFile {
  readonly path: string;
  readonly contents: string;
  readonly mode?: number;
}

export interface SshAskpassHelperDescriptor {
  readonly helperPath: string;
  readonly files: ReadonlyArray<SshAskpassFile>;
}

export interface SshAuthOptions {
  readonly authSecret?: string | null;
  readonly batchMode?: "yes" | "no";
  readonly interactiveAuth?: boolean;
}

export interface SshPasswordPromptShape {
  readonly isAvailable: boolean;
  readonly request: (
    request: SshPasswordRequest,
  ) => Effect.Effect<string | null, SshPasswordPromptError>;
}

export class SshPasswordPrompt extends Context.Service<SshPasswordPrompt, SshPasswordPromptShape>()(
  "@orbiwork/ssh/auth/SshPasswordPrompt",
) {
  static readonly disabledLayer = Layer.succeed(
    SshPasswordPrompt,
    SshPasswordPrompt.of({
      isAvailable: false,
      request: Effect.fn("SshPasswordPrompt.request")(function () {
        return Effect.succeed(null);
      }),
    }),
  );
}

export interface SshChildEnvironmentOptions {
  readonly interactiveAuth?: boolean;
  readonly baseEnv?: NodeJS.ProcessEnv;
  readonly askpassDirectory?: string;
  readonly authSecret?: string | null;
  /** The connection the password belongs to; without it no prompt is answered. */
  readonly target?: DesktopSshEnvironmentTarget;
}

const SSH_ASKPASS_DIR_NAME = "orbiwork-ssh-askpass";

function joinSshAskpassPath(
  directory: string,
  fileName: string,
  platform: NodeJS.Platform,
): string {
  const trimmed = directory.replace(/[\\/]+$/u, "");
  return platform === "win32" ? `${trimmed}\\${fileName}` : `${trimmed}/${fileName}`;
}

// The password is never in an environment or argv: ssh's environment names a 0600 file holding it
// on line 1 and the exact prompts it may answer below. The helper gets the prompt as its last
// argument and declines any other (passphrases, host keys, other hosts), so ssh fails closed.
// It removes the file once it hands the password over; the caller removes it when the attempt ends.
const ASKPASS_POSIX_SCRIPT = `#!/bin/sh
ORBI_PROMPT=
for ORBI_PROMPT; do :; done
ORBI_FILE="\${ORBI_SSH_AUTH_SECRET_FILE:-}"
ORBI_NL='
'
case "\${ORBI_PROMPT:-}" in
  *"$ORBI_NL"*) ORBI_PROMPT= ;;
esac
ORBI_PROMPT="$(printf '%s' "\${ORBI_PROMPT:-}" | tr '[:upper:]' '[:lower:]' | sed 's/[[:space:]]*$//')"
if [ -z "$ORBI_FILE" ] || [ ! -f "$ORBI_FILE" ] || [ -z "$ORBI_PROMPT" ] ||
  ! sed '1d' "$ORBI_FILE" | grep -Fxq -e "$ORBI_PROMPT"; then
  printf 'OrbiWork ssh-askpass declined a prompt that is not the saved account password request.\\n' >&2
  exit 1
fi
IFS= read -r ORBI_SECRET <"$ORBI_FILE" || true
rm -f "$ORBI_FILE"
printf '%s\\n' "$ORBI_SECRET"
`;

// Windows has no helper form every ssh can start. Win32-OpenSSH starts `"<node>" "<this file>"`
// directly; Cygwin/MSYS ssh (Git for Windows) execs ssh-askpass.sh through its own sh. Either
// way ssh appends the prompt as the last argument.
const ASKPASS_WINDOWS_NODE_SCRIPT = `// OrbiWork ssh-askpass: answers only the prompts listed in ORBI_SSH_AUTH_SECRET_FILE.
const fs = require("node:fs");
const file = process.env.ORBI_SSH_AUTH_SECRET_FILE || "";
const raw = String(process.argv[process.argv.length - 1] || "");
const prompt = /[\\r\\n]/.test(raw) ? "" : raw.toLowerCase().replace(/\\s+$/, "");
let lines = [];
try {
  lines = file && prompt ? fs.readFileSync(file, "utf8").split("\\n") : [];
} catch {}
if (lines.length < 2 || !lines.slice(1).includes(prompt)) {
  process.stderr.write("OrbiWork ssh-askpass declined a prompt that is not the saved account password request.\\n");
  process.exit(1);
}
try {
  fs.rmSync(file, { force: true });
} catch {}
process.stdout.write(lines[0] + "\\n");
process.exit(0);
`;

// OpenSSH's password prompt (`user@host's password:`) and its keyboard-interactive prefix
// (`(user@host) Password:`, OpenSSH 8.4+), for the resolved host name and the alias.
function sshPasswordPrompts(target: DesktopSshEnvironmentTarget): ReadonlyArray<string> {
  const username = target.username?.trim();
  if (!username) return [];
  const hosts = new Set(
    [target.hostname, target.alias].map((host) => host.trim()).filter((host) => host.length > 0),
  );
  return [...hosts]
    .flatMap((host) => [`${username}@${host}'s password:`, `(${username}@${host}) password:`])
    .map((prompt) => prompt.toLowerCase())
    .filter((prompt) => !/[\r\n]/u.test(prompt));
}

const buildSshAskpassHelperDescriptor = Effect.fn("ssh/auth.buildSshAskpassHelperDescriptor")(
  function* (input: {
    readonly directory: string;
  }): Effect.fn.Return<SshAskpassHelperDescriptor, never, Path.Path> {
    const platform = yield* HostProcess.Platform;
    const path = yield* Path.Path;
    const directory = input.directory;

    if (platform === "win32") {
      const helperPath = joinSshAskpassPath(directory, "ssh-askpass.cjs", platform);
      return {
        helperPath,
        files: [
          { path: helperPath, contents: ASKPASS_WINDOWS_NODE_SCRIPT },
          {
            path: joinSshAskpassPath(directory, "ssh-askpass.sh", platform),
            contents: ASKPASS_POSIX_SCRIPT,
          },
        ],
      };
    }

    return {
      helperPath: path.join(directory, "ssh-askpass.sh"),
      files: [
        {
          path: path.join(directory, "ssh-askpass.sh"),
          contents: ASKPASS_POSIX_SCRIPT,
          mode: 0o700,
        },
      ],
    };
  },
);

const ensureSshAskpassHelpers = Effect.fn("ssh/auth.ensureSshAskpassHelpers")(function* (input: {
  readonly directory: string;
}): Effect.fn.Return<string, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const descriptor = yield* buildSshAskpassHelperDescriptor(input);
  const platform = yield* HostProcess.Platform;

  yield* fs.makeDirectory(path.dirname(descriptor.helperPath), { recursive: true });

  for (const file of descriptor.files) {
    const existing = yield* fs.exists(file.path);
    const current = existing ? yield* fs.readFileString(file.path) : null;
    if (current !== file.contents) {
      yield* fs.writeFileString(file.path, file.contents);
    }
    if (file.mode !== undefined && platform !== "win32") {
      yield* fs.chmod(file.path, file.mode);
    }
  }

  return descriptor.helperPath;
});

// Keep setup serialized through cancellation so writes finish before another command uses the helper.
let defaultSshAskpassRuntimeDirectory: string | undefined;
const defaultSshAskpassLock = Semaphore.makeUnsafe(1);

const ensureDefaultSshAskpassHelpers = Effect.fn("ssh/auth.ensureDefaultSshAskpassHelpers")(
  function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const userId = yield* HostProcess.UserId;
    let runtimeDirectory = defaultSshAskpassRuntimeDirectory;
    if (runtimeDirectory !== undefined) {
      const cached = runtimeDirectory;
      const reusable = yield* Effect.all([fs.realPath(cached), fs.stat(cached)]).pipe(
        Effect.map(
          ([resolved, info]) =>
            resolved === cached &&
            info.type === "Directory" &&
            (userId === undefined || Option.getOrUndefined(info.uid) === userId),
        ),
        Effect.orElseSucceed(() => false),
      );
      if (!reusable) {
        runtimeDirectory = undefined;
      }
    }
    runtimeDirectory ??= yield* fs.realPath(
      yield* fs.makeTempDirectory({ prefix: "orbiwork-ssh-runtime-" }),
    );
    const helperPath = yield* ensureSshAskpassHelpers({
      directory: path.join(runtimeDirectory, SSH_ASKPASS_DIR_NAME),
    });
    defaultSshAskpassRuntimeDirectory = runtimeDirectory;
    return helperPath;
  },
  (effect) => defaultSshAskpassLock.withPermit(Effect.uninterruptible(effect)),
);

// Anything that does not identify as Win32-OpenSSH gets the shell helper. A client that cannot
// start it fails to authenticate.
const isWin32OpenSsh = Effect.fn("ssh/auth.isWin32OpenSsh")(
  function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(ChildProcess.make("ssh.exe", ["-V"]));
    const banner = yield* handle.stderr.pipe(Stream.decodeText(), Stream.mkString);
    return banner.includes("OpenSSH_for_Windows");
  },
  Effect.scoped,
  Effect.orElseSucceed(() => false),
);

/**
 * The ssh child's environment. With `authSecret` the password goes to a 0600 file beside the
 * helper that is removed when the caller's scope closes, if the helper has not removed it already.
 */
export const buildSshChildEnvironment = Effect.fn("ssh/auth.buildSshChildEnvironment")(function* (
  input: SshChildEnvironmentOptions = {},
): Effect.fn.Return<
  NodeJS.ProcessEnv,
  PlatformError.PlatformError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path | Scope.Scope
> {
  const baseEnv = { ...input.baseEnv };
  if (!input.interactiveAuth) {
    return baseEnv;
  }

  const platform = yield* HostProcess.Platform;
  const hostDisplay = input.baseEnv
    ? input.baseEnv.DISPLAY
    : yield* Config.String("DISPLAY").pipe(
        Config.option,
        Effect.orElseSucceed(() => Option.none<string>()),
        Effect.map(Option.getOrUndefined),
      );
  const helperPath =
    input.askpassDirectory === undefined
      ? yield* ensureDefaultSshAskpassHelpers()
      : yield* ensureSshAskpassHelpers({ directory: input.askpassDirectory });

  // Set even when empty, so a value inherited from this process cannot point the helper elsewhere.
  let secretFile = "";
  if (input.authSecret) {
    const fs = yield* FileSystem.FileSystem;
    secretFile = helperPath.replace(
      /ssh-askpass\.(?:sh|cjs)$/u,
      `ssh-askpass-secret-${SecureRandom.uuidV4Unsafe()}`,
    );
    // ssh reads askpass output up to the first line break, so nothing after it could be sent.
    const secret = input.authSecret.split(/[\r\n]/u)[0] ?? "";
    const prompts = input.target === undefined ? [] : sshPasswordPrompts(input.target);
    const fileToRemove = secretFile;
    yield* Effect.addFinalizer(() => fs.remove(fileToRemove, { force: true }).pipe(Effect.ignore));
    yield* fs.writeFileString(secretFile, [secret, ...prompts, ""].join("\n"), {
      flag: "wx",
      mode: 0o600,
    });
  }
  const authSecretEnv = { ORBI_SSH_AUTH_SECRET_FILE: secretFile };

  if (platform === "win32") {
    if (!(yield* isWin32OpenSsh())) {
      return {
        ...baseEnv,
        SSH_ASKPASS: helperPath.replace(/\.cjs$/u, ".sh"),
        SSH_ASKPASS_REQUIRE: "force",
        ...authSecretEnv,
      };
    }
    // Win32-OpenSSH uses a value that starts with a quote as the command line as written; an
    // unquoted one is split after a lower-case ".exe" only. The single-executable orbi.exe ignores
    // a script argument, so it loads the helper through NODE_OPTIONS instead.
    const execPath = yield* HostProcess.ExecutablePath;
    const preload = (yield* HostProcess.IsExecutable)
      ? { NODE_OPTIONS: `--require "${helperPath.replaceAll("\\", "/")}"` }
      : {};
    return {
      ...baseEnv,
      SSH_ASKPASS: `"${execPath}" "${helperPath}"`,
      SSH_ASKPASS_REQUIRE: "force",
      ELECTRON_RUN_AS_NODE: "1",
      ...preload,
      ...authSecretEnv,
    };
  }

  return {
    ...baseEnv,
    SSH_ASKPASS: helperPath,
    SSH_ASKPASS_REQUIRE: "force",
    ...authSecretEnv,
    ...(baseEnv.DISPLAY || hostDisplay ? {} : { DISPLAY: "orbiwork" }),
  };
});

export function isSshAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    /permission denied \((?:publickey|password|keyboard-interactive|hostbased|gssapi-with-mic)[^)]*\)/u.test(
      normalized,
    ) ||
    /authentication failed/u.test(normalized) ||
    /too many authentication failures/u.test(normalized)
  );
}

// A local agent signing failure cannot be remedied by the remote account password.
export function isSshAgentSigningFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /sign_and_send_pubkey: signing failed(?: for [^\n]* from agent:|: (?:agent refused operation|communication with agent failed))/u.test(
    message,
  );
}
