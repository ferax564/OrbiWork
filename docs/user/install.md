# Install OrbiWork

OrbiWork runs coding agents on your computer and lets you control them from its
desktop app or a browser. Set up the machine where the agents will work first.

## Requirements

You need an installed, authenticated provider before starting a thread. You can
launch OrbiWork and configure providers afterwards.

## Command line

OrbiWork has no published releases, installers, or packages yet, so build the
server from source. You need Node 26.13.1 and pnpm 12.14.0, or `vp`, which
provides them ([Install vp](../operations/00_development.md#first-checkout)):

```bash
git clone https://github.com/ferax564/OrbiWork
cd OrbiWork && vp i && vp run build:desktop
node apps/server/dist/bin.mjs
```

The commands below are written as `orbi`; with a source build, run
`node apps/server/dist/bin.mjs` in its place. `orbi update` and the background
service do not apply to a server run this way; update it with `git pull` and a
rebuild.

| Task                                  | Command                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------- |
| Start the server and open the web app | `orbi`                                                                    |
| Start the server without a browser    | `orbi serve`                                                              |
| Use it from your other devices        | `orbi up` ([details](./remote-access.md))                                 |
| Keep it running in the background     | `orbi service install` ([details](./background-service.md))               |
| Move to the newest release            | `orbi update`                                                             |
| Reclaim database space                | `orbi doctor` ([details](./background-service.md#reclaim-database-space)) |
| Remove it again                       | `orbi uninstall`                                                          |

Run `orbi help` or `orbi --help` for the full reference. To start in a new working
directory, use an explicit path such as `orbi ./my-project`. A bare directory name
is accepted only if it already exists.

If `orbi` or `orbi start` reports an already running server, run the `orbi pair`
command it names and open the pairing URL to connect to that server. Stop it
before starting a replacement, or use a different `--base-dir` for an
independent server.

OrbiWork publishes no npm package, so do not run it through `npx`, `pnpm dlx`, or
`bunx`.

## Desktop app

There are no published desktop builds yet. Run the desktop app from a checkout
with `vp run dev:desktop`, or package it yourself as described in
[Desktop artifacts](../operations/00_development.md#desktop-artifacts).

### The `orbi` command

The desktop app includes the `orbi` command-line tool. A new install sets it up
on first launch; after an update, or any time, choose **Install** next to
**orbi command** in **Settings → About**. On macOS and Linux it adds a `orbi` link
in `~/.local/bin` (or `~/bin`); on Windows it adds the app's command folder to
your `PATH`. Open a new terminal afterwards. If the folder is not on your
`PATH`, **Add to PATH** on the Welcome page or in **Settings → About** adds one
line to your shell's startup file. **Remove** takes it off, and the app does not
add it again. If you already have another `orbi`, it stays as it is.

### Windows Subsystem for Linux

Choose a WSL distro in **Settings → Sharing & access** to run agents and projects
there. Install the provider CLIs inside that distro. OrbiWork installs its own
server runtime there automatically; the first launch after an app update can
take longer.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
orbi app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `orbi app ../my-project`, to open another directory. It requires
the desktop app, so a standalone server or an SSH session is not enough. If the
command cannot reach the app, start or update the desktop app and try again.

### Drop a folder on the sidebar

Drag one or more folders from Finder, Explorer, or your file manager onto the
sidebar. Each one opens as a project on this computer, the same as `orbi app`.
Files dropped on a thread still attach to that thread. Browsers do not share
folder paths, so in the web app use **Add project** instead.

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider   | Install and authenticate                                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex      | [Connect with ChatGPT](./providers-codex.md#connect-with-chatgpt), or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. |
| Claude     | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`.                                                              |
| ACP agents | Install the agent's ACP command, then [add it](./providers-acp.md#add-an-agent) from **Settings → Providers → Add provider → Show more**.                 |

Provider CLIs must be on the server's `PATH`. If OrbiWork cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Codex connected through ChatGPT can use its managed runtime without a `PATH` entry.

OrbiWork warns when a provider version has known compatibility problems with your
release. Check **Settings → Providers** on that environment for the recommended
version or range. When its package manager supports installing a specific version,
you can install the recommendation there. Otherwise use the provider's installer
on the environment's machine. An unlisted version is unverified.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** runs the installer that owns the CLI
(Homebrew, mise, or a global npm, pnpm, Yarn, Bun, Volta, or Vite+ install), or
the CLI's own update command when OrbiWork cannot tell. Claude and Codex
installs OrbiWork cannot identify stay manual: update them through the
installer you used. OrbiWork runs `mise upgrade`
only for a tool your mise config requests as `latest` when the provider's binary
path is a mise shim or under the tool's `installs/<tool>/latest` link; update a
pinned version, or a path into one version's directory, through mise yourself.
Update a CLI installed with Nix through Nix.
Homebrew and Chocolatey installs
compare against the version their package manager offers, which can trail the
npm release; update Claude installed with Chocolatey through Chocolatey.

The managed runtime for Codex connected through ChatGPT
first installs the release OrbiWork tested. When OrbiWork finds a newer compatible
release, its setup in **Settings → Providers** offers an update.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, OrbiWork does not display
their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), and [ACP agents](./providers-acp.md).

### Provider check timeouts

If a provider works in its CLI but OrbiWork reports a timeout while checking it,
allow more time in the Orbi server's environment. For example, give Codex and
Claude readiness checks 60 seconds:

```bash
ORBIWORK_CODEX_PROBE_TIMEOUT_MS=60000 ORBIWORK_CLAUDE_PROBE_TIMEOUT_MS=60000 orbi serve
```

For a remote environment, set these on the machine running the Orbi server.
Keep them in your launcher or service configuration to retain them across
updates, then restart the server. For systemd, add
`Environment=ORBIWORK_CODEX_PROBE_TIMEOUT_MS=60000` under `[Service]` in a service
override, reload systemd, and restart the service. Provider instances can also
set their own overrides in Settings → Providers.

Each variable extends that provider's readiness-probe deadlines; a phase whose
default is already longer keeps its default. Providers with several phases can
take longer than one deadline in total. Values must be whole milliseconds no
greater than 2147483647; unset or invalid values keep the defaults.

| Provider   | Environment variable                     |
| ---------- | ---------------------------------------- |
| Codex      | `ORBIWORK_CODEX_PROBE_TIMEOUT_MS`        |
| Claude     | `ORBIWORK_CLAUDE_PROBE_TIMEOUT_MS`       |
| ACP agents | `ORBIWORK_ACP_REGISTRY_PROBE_TIMEOUT_MS` |

Longer deadlines also take longer to report a stalled check. These overrides
cover readiness and discovery. Usage and
config enrichment retain their own shorter limits. Turn execution, package
installation, update checks, and shutdown limits keep their existing behavior.

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a host available.
- [Updating OrbiWork](./updating.md): update the app and connected servers.
- [Managed policy](./managed-policy.md): configure OrbiWork for everyone on a machine.
