<h1 align="center">OrbiWork</h1>

<p align="center">A minimal, local-first console for coding agents.</p>

OrbiWork runs the coding agents already installed on your machine and gives them one fast
interface: durable threads, approvals, a terminal, diffs, and git worktrees.

It is early. There are no published releases, installers, store apps, or hosted services yet.
You build it from source.

## Principles

- **Nothing leaves your machine unless you ask.** Analytics, remote configuration and update
  checks are off by default. A few lookups remain and are being removed; the roadmap lists them.
- **No trusted third party in the remote path.** Reach your machine over your own network,
  Tailscale, or SSH.
- **Your subscriptions.** OrbiWork does not resell tokens. It drives the agents you are already
  signed in to.
- **Small and fast.** Features that do not serve the core loop are removed, not hidden.

See [ROADMAP.md](./ROADMAP.md) for what is done and what is next.

## Build from source

You need Node 26.13.1 and pnpm 12.14.0.

```bash
pnpm install
```

```bash
pnpm dev
```

Then sign in to at least one agent, for example
[Claude Code](https://claude.com/product/claude-code) (`claude auth login`) or
[Codex CLI](https://developers.openai.com/codex/cli) (`codex login`).

Checks:

```bash
pnpm typecheck
```

```bash
pnpm lint
```

```bash
pnpm test
```

## Status of this codebase

Parts of the tree still describe features that are scheduled for removal (a hosted relay and
account system, a mobile app, a long tail of providers and forges). Their documentation under
[docs/](./docs/README.md) may mention install channels and services that do not exist for
OrbiWork. Hostnames ending in `.invalid` are placeholders that resolve nowhere.

## Security

See [SECURITY.md](./SECURITY.md). Report vulnerabilities through GitHub's private vulnerability
reporting on this repository.

## License

MIT. See [LICENSE](./LICENSE), which retains the copyright notice of the original authors.
