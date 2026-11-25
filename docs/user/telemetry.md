# Diagnostics data

OrbiWork sends no product usage data or analytics. This page lists what can still leave your
machine for diagnostics, and how to turn each off.

## Agent feedback

Agent feedback lets agents write reports about OrbiWork: a Orbi tool or `orbi` command that did
not do what they expected, a confusing instruction, or a missing capability. Reports are saved on
your machine only and are never sent anywhere. Choose a mode in **Agent feedback** in
**Settings > Labs**:

- **Off**, the default: agents do not see the feedback tools, and `orbi feedback` stops with a
  message pointing to Labs.
- **When I ask**: agents write a report only when you ask them to. OrbiWork shows it in the thread
  as a card, and saves it only if you press **Send**; the card then closes as not sent.
- **Automatic**: agents also save reports about OrbiWork problems they hit on their own.

Before anything is saved, OrbiWork removes file paths, your user name, machine name, project
title, branch, git remote, and anything that looks like a key, token, email address, or URL with a
password. `orbi feedback list` shows recent reports; `orbi feedback list --json` shows exactly what
each one holds.

## Relay connection diagnostics

OrbiWork sends relay connection traces to Axiom to diagnose Orbi Connect connectivity. Depending on the client version, traces can include connection
timings, environment identifiers and the connected machine's name. Failed spans can include error
messages and stack traces; error text can quote a value the app was handling.

Relay tracing is off unless the server's environment sets `ORBIWORK_TELEMETRY_ENABLED=true`; set it
to `false`, or leave it unset, to keep it off. Relay tracing also stops
when `ORBIWORK_OTEL_SDK_DISABLED` or `OTEL_SDK_DISABLED` turns OpenTelemetry export off.

An administrator can turn relay tracing off in the server and desktop app with
a [managed policy](./managed-policy.md#other-capabilities). This does not control traces sent by
separate browser or mobile clients.

The desktop app reads `ORBIWORK_TELEMETRY_ENABLED` from your shell profile (for example `~/.zshrc`) on macOS and
Linux, so export it there and restart the app. On Windows, set it as a user environment variable.

The web app in a browser, including one the `orbi` CLI opens, does not read these environment
variables. When its build has relay tracing configured, it sends its own connection traces even
if the server has opted out. The browser app has no relay tracing toggle.

## Mobile app diagnostics

When the iOS or Android app crashes or hits an error, it sends a report to OrbiWork: the error
message, the stack trace, the app version, and the device model and OS version. Each launch also
sends startup timings, and every report carries a random ID for the install. Reports go through
the Orbi Connect relay to Axiom. They do not include your threads, prompts, or connection details,
but an error message can quote a value the app was handling.

To stop sending them, turn off **Send crash reports** in **Settings > About OrbiWork > Diagnostics**.

The mobile app also sends relay connection traces when its build has tracing configured. These
carry an identifier for the current app session. **Send crash reports** does not control these
traces, and the mobile app has no separate relay tracing toggle. Server environment variables and
managed policy do not disable mobile tracing.

## Agent activity for mobile notifications

When **Publish agent activity** is enabled on a host, it sends project and thread titles, model
names, activity status, and environment and thread identifiers to the Orbi Connect relay for
[mobile notifications and live activities](./mobile-notifications.md). This is separate from
relay diagnostics. `ORBIWORK_TELEMETRY_ENABLED` does not control it.

To stop publishing, turn off **Publish agent activity** under **Settings > Sharing & access** on
the host. Turning off notifications on a phone controls that phone's alerts, not the host's
publishing setting.

## Export diagnostics to your own receiver

To send traces, metrics, or logs to an OpenTelemetry receiver, open
**Settings > Maintenance > Diagnostics**, select an environment, and enter each signal's OTLP HTTP
endpoint under **OpenTelemetry export** (for example `http://localhost:4318/v1/traces`). Save, then
restart that environment's server. The receiver must be reachable from the server's machine.
**Test** sends an empty export from the server to check an endpoint before or after you save it;
saved endpoints are checked when the section opens. Checks send authentication headers only to
the signal's currently running endpoint and do not follow redirects. To check a new endpoint
that requires authentication, save it and restart the server first.

`ORBIWORK_OTLP_*_URL` and standard `OTEL_EXPORTER_OTLP_*` environment variables override the saved
settings. An overridden signal shows **Set by environment** and names the variable that set it, and its
**Test** checks the running endpoint instead of the field. For endpoints saved here or set with `ORBIWORK_OTLP_*_URL`, set `ORBIWORK_OTLP_HEADERS` for
receivers that need authentication and `ORBIWORK_OTLP_PROTOCOL=http/protobuf` for receivers that do
not accept JSON. An endpoint set with `OTEL_EXPORTER_OTLP_*` takes its headers and protocol from
`OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_EXPORTER_OTLP_PROTOCOL` instead.
