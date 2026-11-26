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
- Relay tracing requires an explicit opt-in on server, desktop and web (the relay is now gone).
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
- Done: remove the agent feedback delivery path (it can carry conversation excerpts).
- Remove the star prompt and the token check behind it.
- Done: remote images, video and audio in markdown load on click; no forge avatars or hosted
  connector logos; pull-request status sweeps follow the background fetch setting (off by default).
- Open: provider usage-limit and model lookups on the health refresh still run for signed-in
  providers.
- Add a network-capture regression check: a clean profile at startup and at idle makes zero
  outbound connections.

## Phase 2: remove the hosted trust model

The hosted relay design makes a third party a trusted broker: its signing key can open a full
session, traffic is readable at the tunnel edge, and tunnel routes are set remotely.

- Done: removed hosted sign-in, the relay client, the managed tunnel, guest share links, activity
  publishing, webhook delivery through the relay, the third-party chat account link and
  `infra/relay`. Webhooks sent straight to the server's own address stay.
- Done: the service launcher, boot service and runtime pinning live in `apps/server/src/service/`.
- Keep SSH and Tailscale. Harden SSH: pass the password over a file descriptor, scope the askpass
  helper to password prompts.
- Done in code: an SSH install checks a signed `SHA256SUMS`. It stays off until a release key is
  committed (`docs/operations/03_release.md`). Open: the same check for server self-update.
- Done: pairing codes are 80 bits, links last at most 24 hours, and a key-bound session cannot
  get an unbound socket ticket. A pairing code is refused over plain HTTP from outside the machine
  and the tailnet unless `ORBIWORK_INSECURE_HTTP_PAIRING` is set, and Sharing & access marks the
  addresses that cannot pair. Wrong codes are limited per peer. Media tickets work
  only from the address that asked for them. Session cookies are `Secure` on HTTPS.

## Phase 3: cut breadth

In order of value for effort:

1. `.repos/` vendored references (24k files, 240 MB). Fetch on demand instead.
2. Done: mobile app, its scripts, workflows, patches and lint rules (about 290k lines, 85 MB).
   Phones use the web UI over Tailscale.
3. Upstream CI (29 workflows, most on runners a fork does not have) replaced by one job:
   format, lint, typecheck, unused-code check, tests.
4. `evals/`, marketing site, release and packaging scripts tied to upstream services.
5. Done: providers are Claude, Codex and a generic ACP agent started by a local command. Eight
   others, the hosted ACP registry and a 16.7 MB SDK patch are gone. Open: prune the generated
   Codex schema (56k lines) to reachable methods; keep one ACP schema version; remove vendor
   workarounds left in the shared ACP adapter.
6. Done: source control is git, GitHub and GitLab. Six forges are gone.
7. Server features: device simulators, triage, HTML render, speech; make workflows,
   pull-request review, usage and peer links lazy and default-off.
8. Done: the UI is English-only; office, PDF, SQLite and notebook viewers, the 3D device viewer
   and theme search are gone. Open: settings pages for server features still to be removed.
9. Desktop: browser cookie import and its native helper, screen-capture backends, passkeys.
10. Old-data compatibility: the V1 import layer, 94 migrations squashed to one baseline (new state
    directory), legacy draft migrations, older-client gating.

## Phase 4: performance

Each item needs a before and after number.

Baseline (M-series Mac, empty state, three runs): server cold start 1.15 to 1.22 s; idle server
about 450 MB RSS, 171 MB heap, 0.4% CPU; web boot path 190 chunks, 1.6 MB gzip JS; 144 chunks
are emitted twice. All web JS: 45.9 MB raw, 13.1 MB gzip.

After the Phase 3 cuts (providers, forges, catalogs, viewers): all web JS 31.8 MB raw, 8.4 MB gzip.

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

- Checked on a packaged macOS build: asar integrity, asar-only loading, cookie encryption and no
  inspector arguments are set; no inline scripts; only the app's own URL schemes are registered.
- Open: run-as-node and `NODE_OPTIONS` are still on. The backend, provider adapters, the SSH
  password helper, the CLI shim and the desktop workers all run Electron as Node. Embedding the
  standalone `orbi` binary would fix it at a cost of 150 to 400 MB.
- Connect and frame sources stay open to any origin because environments are added at runtime.

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
