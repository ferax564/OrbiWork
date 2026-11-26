# ACP agents

OrbiWork can run any coding agent that speaks the [Agent Client Protocol](https://agentclientprotocol.com)
(ACP) from a command installed on your environment. The agent brings its own models, tools, and
sign-in, while OrbiWork provides projects, threads, checkpoints, and task delegation.

Codex and Claude have their own providers. Enable them in **Settings → Providers** instead.

OrbiWork prefers the current ACP v2 preview protocol and uses its richer messages, usage, plans,
configuration, compaction, and agent-terminal updates when the agent supports them. It also
negotiates ACP v1 for agents that have not migrated yet.

## Add an agent

1. Install the agent's ACP command on the environment that hosts your OrbiWork server.
2. Open **Settings → Providers**, select **Add provider**, then **Show more** and **Local ACP command**.
3. Enter the executable name or path, add one literal argument per row, and choose a display name.
   For DeepSeek Harness, use `dsh` with arguments `--profile` and `acp`.

Environment overrides apply to the command; credentials and skills remain managed by the installed
agent or its wrapper. OrbiWork launches the executable directly without expanding shell
expressions. On Windows, configure the underlying executable (for example `node.exe`) rather than a
`.cmd` or `.bat` wrapper.

The agent always runs on the machine that hosts your OrbiWork server, also when you connect to it
from another device.

## Signing in

Open the agent's account section in **Settings → Providers** on web or desktop. Choose
**Sign in** and, if the agent offers several methods, select one.

Browser sign-in shows the agent's URL and waits for you to open or copy it before telling the
agent to proceed. The page opens on your device, while the agent runs on the environment.
Terminal methods run in an in-app terminal on that environment. OrbiWork reconnects after terminal
login and waits for the agent to confirm sign-in before reporting success. You can cancel or retry
an expired attempt.

Browser and terminal sign-in leave credentials in the agent's own store. Agents that use API keys
through environment variables still take those keys in the instance's environment settings.

If the agent advertises logout, choose **Sign out**. ACP does not describe account isolation, so
adding another instance does not guarantee a separate account; use the agent's own configuration
to isolate accounts when supported.

## Models and options

The model picker lists the models the agent reports. If the agent reports none, or hides some, add
your own model IDs under **Custom models** in the instance settings. Model IDs that contain JSON
work too.

Other settings the agent offers, such as reasoning effort or approval mode, appear in the
composer's model picker beside the model list. Models and options that change while an agent is
running update the picker without waiting for another provider check.

## Commands and skills

Slash commands the agent provides appear under **Provider** in the `/` menu while a session is
running. Commands the agent names with a `$` prefix appear in OrbiWork's `$` skill menu instead.

## Native sessions

When an agent advertises ACP session listing and import support, expand its provider card,
choose a project, and select **List sessions**. Importing one creates an OrbiWork thread backed by
that native session. Importing the same session again returns the existing thread, including when
another client performs the import.

The thread keeps the native session's title as provider metadata without overwriting a title you
set in OrbiWork. Agents that report ACP context usage drive the thread's context window and cost
details. Binary resources, images, and audio that OrbiWork cannot render yet appear as placeholders.

## Permissions and terminals

ACP agents read files, edit, and run commands themselves, under their own sandbox and approval
rules. They start in their own default mode, and their mode picker in the model options menu
switches it.

When an agent asks for approval, OrbiWork answers by the thread's
[permission mode](./permission-modes.md): **Supervised** shows the request in the conversation,
**Auto-accept edits** approves edits and shows the rest, and **Auto** and **Full access** approve
automatically. File reads and searches never wait for approval. OrbiWork shows the commands,
output, and exit status the agent reports but does not run or stop its terminals.

ACP agents can schedule work and use OrbiWork's MCP tools. ACP has no portable subagent contract,
so child tasks may appear only as tool activity.

## Checkpoints

Checkpoint rollback restores your files as usual. ACP agents cannot rewind their own conversation,
so the next turn after a rollback starts a fresh agent session and OrbiWork sends it the kept
conversation, without the turns you rolled back.

ACP agents are not used for OrbiWork's own text generation, such as thread titles, commit messages,
or branch names. Configure Codex or Claude for those actions.

## Advanced configuration

- **Authentication method** picks a specific method when the agent advertises more than one.
- **Custom models** adds model IDs the agent does not report.
