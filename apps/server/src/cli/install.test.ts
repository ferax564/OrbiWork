import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@orbiwork/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import packageJson from "../../package.json" with { type: "json" };
import { posixLauncherScript } from "../cloud/pinnedRuntime.ts";
import { installCli } from "./install.ts";

const VERSION = packageJson.version;

/** A standalone runtime in a temp Orbi home. */
const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "orbi-install-" });
  const runtimeDir = path.join(root, ".orbi/runtime");
  const executable = path.join(runtimeDir, "versions", VERSION, "orbi");
  yield* fs.makeDirectory(path.dirname(executable), { recursive: true });
  yield* fs.writeFileString(executable, "");
  const binDir = path.join(root, "bin");
  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>, env: NodeJS.ProcessEnv = {}) =>
    effect.pipe(
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(HostProcess.HomeDirectory, root),
      Effect.provideService(HostProcess.IsExecutable, true),
      Effect.provideService(HostProcess.ExecutablePath, executable),
      Effect.provideService(HostProcess.Environment, {
        PATH: "/usr/bin",
        SHELL: "/bin/zsh",
        ORBIWORK_INSTALL_BIN_DIR: binDir,
        ...env,
      }),
    );
  return { root, runtimeDir, executable, link: path.join(binDir, "orbi"), provide };
});

it.layer(NodeServices.layer)("orbi install", (it) => {
  it.effect("installs the running runtime, records it, and never replaces another orbi", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { root, runtimeDir, executable, link, provide } = yield* setup;

      const older = path.join(runtimeDir, "versions/0.0.1/orbi");
      yield* fs.makeDirectory(path.dirname(link), { recursive: true });
      yield* fs.symlink(older, link);
      const installed = yield* provide(installCli());
      assert.equal(yield* fs.readFileString(link), posixLauncherScript(executable));
      assert.isFalse(installed.onPath);
      assert.include(installed.pathCommand, "$HOME/bin");

      // A link written through a symlinked Orbi home is still ours.
      const alias = path.join(root, "alias");
      yield* fs.symlink(path.join(root, ".orbi"), alias);
      yield* fs.remove(link);
      yield* fs.symlink(path.join(alias, "runtime/versions", VERSION, "orbi"), link);
      const onPath = yield* provide(installCli(), { PATH: `/usr/bin:${path.join(root, "bin")}/` });
      assert.isTrue(onPath.onPath);
      // Another orbi earlier on PATH still runs first, so `orbi` would not run this one.
      const binDir = path.join(root, "bin");
      const otherBin = path.join(root, "other-bin");
      yield* fs.makeDirectory(otherBin);
      yield* fs.writeFileString(path.join(otherBin, "orbi"), "", { mode: 0o755 });
      const installIn = (cwd: string, PATH: string) =>
        provide(installCli().pipe(Effect.provideService(HostProcess.WorkingDirectory, cwd)), {
          PATH,
        });
      const assertShadowed = (result: Effect.Success<ReturnType<typeof installCli>>) => {
        assert.isFalse(result.onPath);
        assert.equal(result.shadowedBy, path.join(otherBin, "orbi"));
        assert.isUndefined(result.pathCommand);
      };
      assertShadowed(yield* provide(installCli(), { PATH: `${otherBin}:${binDir}` }));
      // Relative and empty entries resolve against the working directory.
      assertShadowed(yield* installIn(root, `other-bin:${binDir}`));
      assertShadowed(yield* installIn(otherBin, `:${binDir}`));
      // An empty PATH is not the working directory.
      const offPath = yield* installIn(otherBin, "");
      assert.isUndefined(offPath.shadowedBy);
      assert.isDefined(offPath.pathCommand);
      // A symlink to binDir, or a relative entry to it that wins first, is this install.
      yield* fs.remove(alias);
      yield* fs.symlink(binDir, alias);
      for (const pathEnv of [`${alias}:${otherBin}`, `bin:other-bin:${binDir}`]) {
        const installedOnPath = yield* installIn(root, pathEnv);
        assert.isTrue(installedOnPath.onPath);
        assert.isUndefined(installedOnPath.shadowedBy);
      }
      yield* fs.remove(alias);
      yield* fs.remove(path.join(otherBin, "orbi"));
      yield* fs.makeDirectory(path.join(otherBin, "orbi"));
      const directory = yield* provide(installCli(), {
        PATH: `${otherBin}:${path.join(root, "bin")}`,
      });
      assert.isTrue(directory.onPath);
      assert.isUndefined(directory.shadowedBy);
      const recorded = yield* fs.readFileString(path.join(runtimeDir, "launchers"));
      assert.equal(recorded, `\n${yield* fs.realPath(path.join(root, "bin"))}/orbi\n`);

      yield* fs.remove(link);
      yield* fs.writeFileString(link, "#!/bin/sh\n");
      const error = yield* provide(installCli()).pipe(Effect.flip);
      assert.include(error.message, "Another orbi is already at");
      assert.equal(yield* fs.readFileString(link), "#!/bin/sh\n");

      // Only `<version>/orbi` is ours, not another program inside a version.
      yield* fs.remove(link);
      yield* fs.symlink(path.join(runtimeDir, "versions/0.0.1/node"), link);
      const sibling = yield* provide(installCli()).pipe(Effect.flip);
      assert.include(sibling.message, "Another orbi is already at");
      // This home's desktop launcher is replaced, as install.sh does.
      yield* fs.remove(link);
      yield* fs.symlink(path.join(root, ".orbi/bin/orbi"), link);
      yield* provide(installCli());
      assert.equal(yield* fs.readFileString(link), posixLauncherScript(executable));

      // A script an earlier install wrote is ours too.
      yield* fs.writeFileString(link, posixLauncherScript(older));
      yield* provide(installCli());
      assert.equal(yield* fs.readFileString(link), posixLauncherScript(executable));

      // An empty spot is created exclusively: a file that appears first is kept.
      yield* fs.remove(link);
      const racing = installCli().pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          link: (from, to) =>
            fs
              .writeFileString(to, "#!/bin/sh\necho raced\n")
              .pipe(Effect.andThen(fs.link(from, to))),
        }),
      );
      assert.include((yield* provide(racing).pipe(Effect.flip)).message, "Could not write");
      assert.equal(yield* fs.readFileString(link), "#!/bin/sh\necho raced\n");
      yield* fs.remove(link);

      // Windows writes a orbi.cmd: only over its own, and only for paths cmd can run.
      const shim = path.join(root, "bin", "orbi.cmd");
      const windows = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        provide(effect.pipe(Effect.provideService(HostProcess.Platform, "win32")));
      const desktopShim =
        '@echo off\r\nrem Written by OrbiWork\r\n"C:\\OrbiWork\\OrbiWork.exe" "x" %*\r\n';
      yield* fs.writeFileString(shim, desktopShim);
      const foreignShim = yield* windows(installCli()).pipe(Effect.flip);
      assert.include(foreignShim.message, "Another orbi is already at");
      assert.equal(yield* fs.readFileString(shim), desktopShim);
      // A user's wrapper that also runs a managed orbi.exe is still theirs.
      const wrapper = `@echo off\r\nset FOO=1\r\n"${path.join(runtimeDir, "versions/0.0.1/orbi.exe")}" %*`;
      yield* fs.writeFileString(shim, wrapper);
      yield* windows(installCli()).pipe(Effect.flip);
      assert.equal(yield* fs.readFileString(shim), wrapper);
      // A dangling symlink is not free; writing through it would land outside the bin folder.
      const elsewhere = path.join(root, "elsewhere.cmd");
      yield* fs.remove(shim);
      yield* fs.symlink(elsewhere, shim);
      yield* windows(installCli()).pipe(Effect.flip);
      assert.isFalse(yield* fs.exists(elsewhere));
      yield* fs.remove(shim);
      yield* fs.writeFileString(
        shim,
        `@echo off\r\n"${path.join(runtimeDir, "versions/0.0.1/orbi.exe")}" %*`,
      );
      const windowsInstalled = yield* windows(installCli());
      assert.equal(yield* fs.readFileString(shim), `@echo off\r\n"${executable}" %*`);
      // A PowerShell command for this window; the saved PATH is left to the user.
      assert.equal(windowsInstalled.pathCommand, `$env:Path += ';${path.join(root, "bin")}'`);
      const unrunnable = yield* windows(
        installCli().pipe(
          Effect.provideService(
            HostProcess.ExecutablePath,
            path.join(runtimeDir, "versions/100%/orbi"),
          ),
        ),
      ).pipe(Effect.flip);
      assert.include(unrunnable.message, "has % or non-ASCII characters");
    }),
  );
});
