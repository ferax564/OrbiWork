import { AgentFeedbackKind, AgentFeedbackTrace } from "@orbiwork/contracts";
import { resolveOrbiMcpToolId } from "@orbiwork/shared/orbiMcpToolPresentation";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

// Code points, as the scrubber caps them, so a valid input stays a valid report after redaction.
const FeedbackText = Schema.String.check(Schema.isMaxCodePoints(300));

/** Turns the outline of a requested report covers at least. */
export const FEEDBACK_TRACE_TURNS = 5;

const reportFields = {
  kind: AgentFeedbackKind,
  subject: Schema.String.annotate({ description: "Orbi tool name, `orbi` command, or `general`." }),
  expected: FeedbackText,
  actual: FeedbackText,
  workaround: FeedbackText.annotate({ description: "What you did instead, or empty." }),
  // Annotate before the default: an annotation after it never reaches the JSON schema.
  userRequested: Schema.Boolean.annotate({ description: "The user asked for this report." }).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(false)),
  ),
};

export const FeedbackInput = Schema.Struct({
  ...reportFields,
  turns: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
    .annotate({
      description: "How many recent turns, counting this one, the problem spans.",
    })
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed(1))),
});

export const FeedbackTrace = AgentFeedbackTrace;
export type FeedbackTrace = AgentFeedbackTrace;

const storedFields = {
  id: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  source: Schema.Literals(["mcp", "cli"]),
  sent: Schema.Boolean,
};

export const FeedbackReport = Schema.Struct({
  ...reportFields,
  ...storedFields,
  trace: Schema.NullOr(FeedbackTrace),
});

/** What `orbi_feedback` answers: the report, with only the size of what its trace attached. */
export const FeedbackSubmitResult = Schema.Struct({
  ...reportFields,
  ...storedFields,
  trace: Schema.NullOr(FeedbackTrace.mapFields(Struct.omit(["entries"]))),
});

export const FEEDBACK_AWAITING_APPROVAL_NOTE =
  "The user sees this report in a card and chooses there whether to send it and whether to include the conversation. Nothing is sent until they do, and you will not learn their choice. Do not wait for it or send it another way. Call again only if the user asks to change it; that shows a new card.";

/** What `orbi_feedback` answers for a requested report: shown to the user, not yet sent. */
export const FeedbackAwaitingApproval = Schema.Struct({
  status: Schema.Literal("awaiting_approval"),
  note: Schema.String,
});
export type FeedbackAwaitingApproval = typeof FeedbackAwaitingApproval.Type;

export const FEEDBACK_OFF_MESSAGE =
  "Agent feedback is off. Turn it on in OrbiWork under Settings > Labs, then try again.";

export class FeedbackOffError extends Schema.TaggedError<FeedbackOffError>()(
  "FeedbackOffError",
  {},
) {
  override get message() {
    return FEEDBACK_OFF_MESSAGE;
  }
}

export type FeedbackSource = "mcp" | "cli";

// Requested reports count when their card is shown, unprompted ones when stored.
export const MAX_REPORTS_PER_TURN = 3;
// Reports from no turn, such as `orbi feedback`, have no turn to count in.
export const MAX_REPORTS_OUTSIDE_TURNS_PER_HOUR = 10;

export class FeedbackLimitError extends Schema.TaggedError<FeedbackLimitError>()(
  "FeedbackLimitError",
  { scope: Schema.Literals(["turn", "hour", "cards"]) },
) {
  override get message() {
    switch (this.scope) {
      case "turn":
        return `This turn already sent ${MAX_REPORTS_PER_TURN} agent feedback reports; nothing was sent.`;
      case "cards":
        return `This turn already showed the user ${MAX_REPORTS_PER_TURN} agent feedback reports to approve; nothing was shown.`;
      case "hour":
        return `This machine already sent ${MAX_REPORTS_OUTSIDE_TURNS_PER_HOUR} agent feedback reports outside a turn in the last hour; nothing was sent.`;
    }
  }
}

export class FeedbackNotRequestedError extends Schema.TaggedError<FeedbackNotRequestedError>()(
  "FeedbackNotRequestedError",
  { source: Schema.Literals(["mcp", "cli"]) },
) {
  override get message() {
    return this.source === "cli"
      ? "Agent feedback is set to When I ask: ask your agent in a thread to send it, so you can approve what is sent."
      : "Agent feedback is set to When I ask: send a report only when the user asks for one.";
  }
}

export class FeedbackStorageError extends Schema.TaggedError<FeedbackStorageError>()(
  "FeedbackStorageError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return "Could not save agent feedback.";
  }
}

/** The MCP client label `orbi feedback` signs in with, so its reports count as `cli`. */
export const FEEDBACK_CLI_CLIENT_LABEL = "orbi feedback cli";

/** Listed `orbi` command paths a report may name. A CLI test keeps this in step with binCli. */
export const ORBI_CLI_COMMANDS: ReadonlyArray<string> = [
  "orbi",
  "orbi help",
  "orbi serve",
  "orbi app",
  "orbi pair",
  "orbi auth",
  "orbi auth connect-device",
  "orbi auth connect-device approve",
  "orbi auth connect-device list",
  "orbi auth connect-device revoke",
  "orbi auth pairing",
  "orbi auth pairing create",
  "orbi auth pairing list",
  "orbi auth pairing revoke",
  "orbi auth session",
  "orbi auth session issue",
  "orbi auth session list",
  "orbi auth session revoke",
  "orbi environment",
  "orbi environment link",
  "orbi environment list",
  "orbi environment unlink",
  "orbi browser",
  "orbi browser setup",
  "orbi project",
  "orbi project add",
  "orbi project remove",
  "orbi project rename",
  "orbi thread",
  "orbi thread list",
  "orbi thread start",
  "orbi thread send",
  "orbi thread show",
  "orbi feedback",
  "orbi feedback list",
  "orbi workflow",
  "orbi workflow start",
  "orbi workflow list",
  "orbi workflow show",
  "orbi workflow resume",
  "orbi workflow cancel",
  "orbi workflow signal",
  "orbi workflow questions",
  "orbi workflow hooks",
  "orbi workflow store",
  "orbi workflow store list",
  "orbi workflow store set",
  "orbi workflow store delete",
  "orbi up",
  "orbi status",
  "orbi service",
  "orbi service install",
  "orbi service restart",
  "orbi service uninstall",
  "orbi service status",
  "orbi service protect",
  "orbi update",
  "orbi install",
  "orbi uninstall",
  "orbi theme",
  "orbi theme set",
  "orbi theme clear",
  "orbi theme show",
  "orbi trace",
  "orbi trace summary",
  "orbi doctor",
  "orbi policy",
  "orbi policy show",
  "orbi policy check",
  "orbi policy templates",
  "orbi policy settings",
  "orbi triage",
  "orbi connect",
  "orbi connect link",
  "orbi connect login",
  "orbi connect logout",
  "orbi connect publish",
  "orbi connect status",
  "orbi connect unlink",
];

export type FeedbackInput = typeof FeedbackInput.Type;
export type FeedbackReport = typeof FeedbackReport.Type;

export const FEEDBACK_SUBJECT_MESSAGE =
  "Set subject to the exact Orbi tool name, the orbi command, or `general`.";

// The shared resolver knows the presented tools; the prefix covers the rest, such as these.
// Codex also registers `orbiwork-direct` for Orbi tools it keeps out of Code Mode.
const ORBI_PREFIX = /^(?:mcp__orbi[-_]?work(?:[-_]direct)?__|orbi[-_]?work(?:[-_]direct)?[.:/])/iu;

/** The bare name of a registered Orbi tool however a provider prefixed it, else undefined. */
export const resolveOrbiToolName = (name: string, toolNames: ReadonlyArray<string>) => {
  const tool = resolveOrbiMcpToolId(name) ?? name.replace(ORBI_PREFIX, "");
  if (toolNames.includes(tool)) return tool;
  // OpenCode 2 prefixes tools with `orbiwork-<thread>_`, underscores and all: the longest name wins.
  if (!/^orbiwork-/iu.test(name)) return undefined;
  return toolNames
    .filter((candidate) => name.endsWith(`_${candidate}`))
    .toSorted((a, b) => b.length - a.length)[0];
};

/** The stored subject, or undefined when the value names no Orbi tool, `orbi` command, or `general`. */
export const resolveFeedbackSubject = (value: string, toolNames: ReadonlyArray<string>) => {
  const subject = value.trim();
  if (subject === "general" || ORBI_CLI_COMMANDS.includes(subject)) return subject;
  return resolveOrbiToolName(subject, toolNames);
};
