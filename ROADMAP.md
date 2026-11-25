# OrbiWork roadmap

OrbiWork is a minimal, local-first, privacy-first console for coding agents. This roadmap comes
from a full read of the codebase (ten parallel area reviews plus two independent model reviews)
and a third-party security audit of the hosted remote-access design.

Size at the starting point: about 2M lines. Server 794k, web 507k, mobile 269k, client runtime
133k, desktop 93k, plus thirty small packages and 24k vendored reference files. More than half of
the server is tests. The bloat is feature breadth and compatibility layers, not copy-paste.

## Principles

1. Nothing leaves the machine unless the user asked for it. No analytics, no remote config, no
   update checks, no third-party lookups by default.
2. No trusted third party in the remote path. Remote access means Tailscale or SSH, which the user
   controls end to end.
3. The core is: Claude Code and Codex, durable threads, approvals, terminal, diffs, git worktrees.
   Everything else is optional or gone.
4. Measure before tuning. Startup, idle cost and streaming responsiveness each get a number first.

## Phase 0: privacy defaults (done in the first change)

- Product analytics off by default; no baked-in ingest key or host.
- Provider update checks and the remote model manifest off by default.
- Preview tunnel off by default; new-device approval on by default.
- Relay tracing requires an explicit opt-in on server, desktop and web.
- No favicon lookups for arbitrary links.
- Mobile: over-the-air updates off with no built-in feed; crash reports opt-in; no default trace host.
- `.env.example` carries no third-party identifiers.

## Phase 1: finish the egress work

- Delete `apps/server/src/telemetry/` and its call sites, including the code that reads agent login
  files to derive account identifiers, and the client owner/device query parameters.
- Bundle the model manifest; remove the remote fetch.
- Gate or bundle the model price table fetched by the usage service.
- Desktop: updates opt-in with a settings toggle; remote-triggered update, downgrade and channel
  change require local consent.
- Remove the agent feedback delivery path (it can carry conversation excerpts).
- Remove the star prompt and the token check behind it.
- Add a network-capture regression check: a clean profile at startup and at idle makes zero
  outbound connections.

## Phase 2: remove the hosted trust model

The hosted relay design makes a third party a trusted broker: its signing key can open a full
session, traffic is readable at the tunnel edge, and tunnel routes are set remotely.

- Remove hosted sign-in, the relay client, the managed tunnel, guest share links, activity
  publishing, webhook-triggered tasks and `infra/relay`.
- First split the service launcher, boot service and runtime pinning out of `cloud/`, which mixes
  them with the hosted code.
- Keep SSH and Tailscale. Harden SSH: pass the password over a file descriptor, scope the askpass
  helper to password prompts, verify release signatures rather than same-origin checksums.
- Pairing: longer approval codes, no unbound ticket fallback, no plain-HTTP LAN pairing.

## Phase 3: cut breadth

In order of value for effort:

1. `.repos/` vendored references (24k files, 240 MB). Fetch on demand instead.
2. Mobile app, its scripts, workflows, patches and lint rules (about 290k lines, 85 MB). Phones
   use the web UI over Tailscale.
3. Upstream CI (29 workflows, most on runners a fork does not have) replaced by one job:
   format, lint, typecheck, unused-code check, tests.
4. `infra/`, `evals/`, marketing site, release and packaging scripts tied to upstream services.
5. Providers: keep Claude and Codex, generic ACP optional. Drop the rest, including a 16.7 MB
   SDK patch. Prune the generated Codex schema (56k lines) to reachable methods; keep one ACP
   schema version.
6. Source control: keep git and GitHub; GitLab optional. Drop six forges and commit no SDL schemas.
7. Server features: device simulators, triage, feedback, HTML render, speech; make workflows,
   pull-request review, usage and peer links lazy and default-off.
8. Web: nine non-English catalogs, office/PDF/SQLite viewers, 3D device viewer, theme import,
   and the settings pages for everything removed above.
9. Desktop: browser cookie import and its native helper, screen-capture backends, passkeys.
10. Old-data compatibility: the V1 import layer, 94 migrations squashed to one baseline (new state
    directory), legacy draft migrations, older-client gating.

## Phase 4: performance

Each item needs a before and after number.

- Startup: lazy CLI command imports; build optional server layers on first use; lazy desktop
  subsystems; fewer always-mounted hosts in the web root route. Measure with
  `scripts/profile-startup.mjs` and time to first window.
- Idle: remove the 1-minute sweeps and unconditional timers; cap retained terminal sessions
  (worst case today is about 1 GB); no WebSocket compression on loopback; cache source-control
  discovery instead of spawning CLIs per view. Measure process-tree RSS, CPU and wakeups over
  ten minutes.
- Streaming: index lookups instead of array scans and full copies per streamed update; narrower
  projection reads per command; less event-log write amplification. Measure with `report:renders`
  and a timed 5k-item thread benchmark.

## Phase 5: desktop hardening

- Electron fuses, with the backend moved off run-as-node so the signed app cannot be used as a
  general Node binary that inherits its OS permissions.
- Tighter content security policy: no inline scripts, no wildcard connect/frame sources.
- Do not register as a system handler for http/https.

## Structure

- Split the single contracts barrel into feature entry points so apps stop evaluating schemas for
  features they do not ship.
- Break up the 17k-line orchestrator and the 4k-line RPC handler, which is what makes every
  feature hard to remove.
- One state approach in the web app; one markdown pipeline; one headless-browser stack.

## Fork obligations

- Keep the MIT license and upstream copyright notice; add our own line.
- Use our own name, icons, app identifiers, protocol scheme, package names, update feed and
  security contact everywhere a build or a user can see them.
