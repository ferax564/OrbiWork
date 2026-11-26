import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentId,
  MessageId,
  NodeId,
  ProjectId,
  RunAttemptId,
  RunId,
  type ModelSelection,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
} from "@orbiwork/contracts";
import { resolveSelfInvocation, selfInvocationArgs } from "@orbiwork/shared/nodeRuntime";
import * as DateTime from "effect/DateTime";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";

import { makeProviderFailure } from "@orbiwork/provider-core/server/failure";
import * as McpProviderSessions from "@orbiwork/provider-core/server/McpProviderSessions";
import * as TestProviderHost from "@orbiwork/provider-testing/TestProviderHost";
import {
  makeProviderReplayGate,
  type ProviderReplayGate,
} from "@orbiwork/provider-testing/replayGate";
import type { ProviderContinuationRequest } from "@orbiwork/provider-core/server/ProviderContinuationRequests";
import * as ServerSettings from "../../serverSettings.ts";
import type { AcpRegistryLiveConfiguration } from "@orbiwork/provider-acp-registry/testing";
import * as AcpRegistrySupport from "@orbiwork/provider-acp-registry/server/AcpRegistrySupport";
import * as AcpRegistryRuntimeCoordinator from "@orbiwork/provider-acp-registry/server/AcpRegistryRuntimeCoordinator";
import { ACP_SESSION_MODE_OPTION_ID } from "@orbiwork/provider-acp/server/sessionConfig";
import * as AcpSessionRuntime from "@orbiwork/provider-acp/server/AcpSessionRuntime";
import { orbiAcpPromptWithInstructions } from "@orbiwork/provider-core/server/orchestrationInstructions";
import { buildRuntimeInstructions } from "@orbiwork/provider-core/server/runtimeInstructions";
import * as IdAllocator from "@orbiwork/provider-core/server/IdAllocator";
import {
  decodeAcpReplayTranscript,
  makeAcpReplayCompletenessAssertion,
  makeAcpReplayRuntime,
  makeTurnInput,
} from "./AcpAdapterV2.testkit.ts";
import * as ProviderAdapter from "@orbiwork/provider-core/server/ProviderAdapter";
import { AcpRegistryAdapterV2Driver } from "@orbiwork/provider-acp-registry/server";
import {
  ACP_REGISTRY_PROVIDER,
  makeAcpRegistryAdapterV2,
  acpRegistryPromptFailure,
  acpRegistryProbeResult,
} from "@orbiwork/provider-acp-registry/testing";

const decodeAcpRegistryAdapterSettings = Schema.decodeUnknownEffect(
  AcpRegistryAdapterV2Driver.configSchema,
);

const layerHost = TestProviderHost.layer().pipe(
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const layerRegistry = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({
          version: "1.0.0",
          agents: [
            {
              id: "fixture-agent",
              name: "Fixture Agent",
              version: "1.0.0",
              description: "ACP V2 adapter fixture",
              distribution: {
                binary: {
                  "darwin-aarch64": {
                    archive: "https://registry.test/unused",
                    cmd: "fixture-agent",
                    args: [],
                  },
                  "linux-x86_64": {
                    archive: "https://registry.test/unused",
                    cmd: "fixture-agent",
                    args: [],
                  },
                },
              },
            },
          ],
        }),
      ),
    ),
  ),
);

const layerInjectedRuntimeCatalog = Layer.mock(AcpRegistrySupport.AcpRegistryCatalog)({
  resolve: () => Effect.die("the runtime is injected"),
});

const layerTest = Layer.mergeAll(
  NodeServices.layer,
  NodeCrypto.layer,
  IdAllocator.layer,
  McpProviderSessions.layer,
  layerHost,
  layerRegistry,
  ServerSettings.layerTest(),
);

const CLAUDE_ROOT_SESSION = "claude-session";

/** Replay frames of Claude Agent (claude-agent-acp 0.90.0) on ACP v2. */
const claudeFrames = {
  open: [
    { type: "expect_outbound", frame: { kind: "request", method: "initialize", params: "<any>" } },
    {
      type: "emit_inbound",
      frame: {
        kind: "response",
        method: "initialize",
        result: {
          protocolVersion: 2,
          info: { name: "@agentclientprotocol/claude-agent-acp", version: "0.90.0" },
          capabilities: { session: {} },
          authMethods: [],
        },
      },
    },
    { type: "expect_outbound", frame: { kind: "request", method: "session/new", params: "<any>" } },
    {
      type: "emit_inbound",
      frame: {
        kind: "response",
        method: "session/new",
        result: { sessionId: CLAUDE_ROOT_SESSION },
      },
    },
  ],
  update: (sessionId: string, sessionUpdate: Record<string, unknown>) => ({
    type: "emit_inbound",
    frame: {
      kind: "notification",
      method: "session/update",
      params: { sessionId, update: sessionUpdate },
    },
  }),
  childState: (parent: string, child: string, state: string) =>
    claudeFrames.update(parent, {
      sessionUpdate: "subagent_update",
      sessionId: child,
      state: { state },
    }),
  /** A prompt Claude takes in and works on. */
  prompt: (ordinal: number) => [
    {
      type: "expect_outbound",
      frame: { kind: "request", method: "session/prompt", params: "<any>" },
    },
    claudeFrames.update(CLAUDE_ROOT_SESSION, {
      sessionUpdate: "user_message",
      messageId: `user-${ordinal}`,
      content: [{ type: "text", text: "test prompt" }],
    }),
    {
      type: "emit_inbound",
      frame: {
        kind: "response",
        method: "session/prompt",
        result: { messageId: `user-${ordinal}` },
      },
    },
    claudeFrames.update(CLAUDE_ROOT_SESSION, { sessionUpdate: "state_update", state: "running" }),
  ],
  idle: (stopReason: string) =>
    claudeFrames.update(CLAUDE_ROOT_SESSION, {
      sessionUpdate: "state_update",
      state: "idle",
      stopReason,
    }),
  closeRequest: {
    type: "expect_outbound",
    frame: {
      kind: "request",
      method: "session/close",
      params: { sessionId: CLAUDE_ROOT_SESSION },
    },
  },
  closed: {
    type: "emit_inbound",
    frame: { kind: "response", method: "session/close", result: {} },
  },
};

const openClaudeReplaySession = Effect.fn("openClaudeReplaySession")(function* (
  entries: ReadonlyArray<unknown>,
  replayGate?: ProviderReplayGate,
  continuationEnabled = true,
  agentId: string | Record<string, unknown> = "claude-acp",
  replacementEntries?: ReadonlyArray<unknown>,
  runtimeMode: "approval-required" | "full-access" = "approval-required",
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const replayDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "orbi-claude-lifecycle-" });
  const scriptPath = yield* path.fromFileUrl(
    new URL("../../../scripts/acp-replay-agent.ts", import.meta.url),
  );
  const makeReplay = Effect.fn("openClaudeReplaySession.makeReplay")(function* (
    entries: ReadonlyArray<unknown>,
    name: string,
  ) {
    const transcript = yield* decodeAcpReplayTranscript(
      {
        provider: ACP_REGISTRY_PROVIDER,
        protocol: "acp.ndjson-jsonrpc",
        version: "1",
        scenario: name,
        entries: entries as never,
      },
      ACP_REGISTRY_PROVIDER,
    );
    return makeAcpReplayRuntime({
      transcript,
      statusPath: path.join(replayDir, `${name}.json`),
      scriptPath,
      childProcessSpawner,
      fileSystem,
      ...(replayGate === undefined ? {} : { replayGate }),
    });
  });
  const offers: Array<ProviderContinuationRequest> = [];
  const offered = yield* Queue.unbounded<void>();
  const continuationRequests = {
    offer: (request: ProviderContinuationRequest) =>
      Effect.sync(() => {
        offers.push(request);
      }).pipe(Effect.andThen(Queue.offer(offered, undefined)), Effect.asVoid),
  };
  const instanceId = ProviderInstanceId.make("claude-lifecycle");
  const outgoing = yield* Queue.unbounded<unknown>();
  let onTermination: NonNullable<
    AcpSessionRuntime.AcpSessionRuntimeOptions["onTermination"]
  > = () => Effect.die("Runtime has not started");
  const replayRuntime = yield* makeReplay(entries, "claude-lifecycle");
  const replacementRuntime =
    replacementEntries === undefined
      ? replayRuntime
      : yield* makeReplay(replacementEntries, "replacement");
  let started = false;
  const adapterOptions = {
    selfInvocation: yield* resolveSelfInvocation(),
    instanceId,
    settings: yield* decodeAcpRegistryAdapterSettings(
      typeof agentId === "string" ? { agentId } : agentId,
    ),
    environment: {},
    ...(continuationEnabled ? { continuationRequests } : {}),
    makeRuntime: (runtimeInput: Parameters<typeof replayRuntime>[0]) => {
      onTermination = runtimeInput.onTermination;
      const replay = started ? replacementRuntime : replayRuntime;
      started = true;
      return replay({
        ...runtimeInput,
        protocolLogging: {
          logIncoming: false,
          logOutgoing: true,
          logger: (event) =>
            event.stage === "raw" && typeof event.payload === "string"
              ? Queue.offer(outgoing, JSON.parse(event.payload)).pipe(Effect.asVoid)
              : Effect.void,
        },
      });
    },
  };
  const adapter = yield* makeAcpRegistryAdapterV2(adapterOptions).pipe(
    Effect.provide(layerInjectedRuntimeCatalog),
  );
  const threadId = ThreadId.make("thread-claude-lifecycle");
  const modelSelection = { instanceId, model: "default" } as const;
  const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
    runtimeMode,
    interactionMode: "default",
    cwd: replayDir,
  });
  const runtime = yield* adapter.openSession({
    threadId,
    providerSessionId: ProviderSessionId.make("session-claude-lifecycle"),
    modelSelection,
    runtimePolicy,
  });
  yield* Effect.addFinalizer(() => Effect.sync(() => replayGate?.releaseAll()));
  if (continuationEnabled && agentId === "claude-acp") {
    assert.isDefined(
      runtime.hasPendingBackgroundWork,
      "Claude ACP v2 must report background work after foreground idle",
    );
  }
  const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
  yield* runtime.events.pipe(
    Stream.runForEach((event) => Queue.offer(events, event)),
    Effect.forkScoped,
  );
  const providerThread = yield* runtime.ensureThread({ threadId, modelSelection, runtimePolicy });
  const now = yield* DateTime.now;
  const turnInput = (
    ordinal: number,
    options: { readonly continuation?: boolean } = {},
  ): ProviderAdapter.ProviderAdapterV2TurnInput => ({
    appThread: {
      createdBy: "user",
      creationSource: "web",
      id: threadId,
      projectId: ProjectId.make(`project-claude-lifecycle`),
      title: "Claude Agent",
      providerInstanceId: instanceId,
      modelSelection,
      runtimeMode,
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: providerThread.id,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
    threadId,
    runId: RunId.make(`run-claude-lifecycle-${ordinal}`),
    runOrdinal: ordinal,
    providerTurnOrdinal: ordinal,
    attemptId: RunAttemptId.make(`attempt-claude-lifecycle-${ordinal}`),
    rootNodeId: NodeId.make(`node-claude-lifecycle-${ordinal}`),
    providerThread,
    message: {
      ...(options.continuation === true
        ? { createdBy: "agent" as const, creationSource: "provider" as const }
        : { createdBy: "user" as const, creationSource: "web" as const }),
      messageId: MessageId.make(`message-claude-lifecycle-${ordinal}`),
      text: "test prompt",
      attachments: [],
    },
    modelSelection,
    runtimePolicy,
  });
  const until = (predicate: (event: ProviderAdapter.ProviderAdapterV2Event) => boolean) =>
    Effect.gen(function* () {
      const seen: Array<ProviderAdapter.ProviderAdapterV2Event> = [];
      while (true) {
        const event = yield* Queue.take(events);
        seen.push(event);
        if (predicate(event)) return seen;
      }
    });
  const throughMarker = (title: string) =>
    until(
      (event) =>
        event.type === "provider_thread.updated" &&
        event.providerThread.nativeMetadata?.title === title,
    );
  const terminal = until((event) => event.type === "turn.terminal").pipe(
    Effect.map((seen) => {
      const event = seen.at(-1)!;
      if (event.type !== "turn.terminal") throw new Error("Missing terminal");
      return event;
    }),
  );
  return {
    runtime,
    providerThread,
    turnInput,
    until,
    throughMarker,
    terminal,
    offers,
    offered,
    outgoing,
    terminate: () =>
      onTermination(
        new EffectAcpErrors.AcpTransportError({
          detail: "Injected fixture process exit",
          cause: "test",
        }),
      ),
  };
});

const claudeMarker = (title: string) =>
  claudeFrames.update(CLAUDE_ROOT_SESSION, {
    sessionUpdate: "session_info_update",
    title,
  });
describe("AcpRegistryAdapterV2", () => {
  it.effect.each([
    { commandPath: "/root/.local/bin/agy", offers: 1 },
    { commandPath: "C:\\tools\\agy.exe", offers: 1 },
    { commandPath: "/opt/bin/other-agent", offers: 0 },
  ])("continues late output only for agy ($commandPath)", ({ commandPath, offers }) =>
    Effect.gen(function* () {
      const gate = makeProviderReplayGate(["wake"]);
      const update = (sessionUpdate: Record<string, unknown>) =>
        claudeFrames.update(CLAUDE_ROOT_SESSION, sessionUpdate);
      const session = yield* openClaudeReplaySession(
        [
          {
            type: "expect_outbound",
            frame: { kind: "request", method: "initialize", params: "<any>" },
          },
          {
            type: "emit_inbound",
            frame: {
              kind: "response",
              method: "initialize",
              result: {
                protocolVersion: 1,
                agentInfo: { name: "Antigravity ACP Server", version: "1.5.9" },
                agentCapabilities: { loadSession: true },
                authMethods: [],
              },
            },
          },
          claudeFrames.open[2],
          claudeFrames.open[3],
          claudeFrames.prompt(1)[0],
          {
            type: "emit_inbound",
            frame: {
              kind: "response",
              method: "session/prompt",
              result: { stopReason: "end_turn" },
            },
          },
          {
            ...update({
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Background work finished." },
            }),
            label: "wake",
          },
          // agy ends each reply with usage_update; this one ends before the continuation run starts.
          update({ sessionUpdate: "usage_update", used: 100, size: 1000 }),
          claudeMarker("late output received"),
        ],
        gate,
        true,
        { commandPath, commandArgs: ["acp"] },
      );
      yield* session.runtime.startTurn(session.turnInput(1));
      assert.equal((yield* session.terminal).status, "completed");
      gate.release("wake");
      yield* session.throughMarker("late output received");
      assert.lengthOf(session.offers, offers, "late output must only wake agy");
      if (offers === 0) return;
      yield* session.offers[0]!.dispatchIfCurrent!(Effect.void);
      yield* session.runtime.startTurn(session.turnInput(2, { continuation: true }));
      yield* TestClock.adjust("3 seconds");
      const continued = yield* session.until((event) => event.type === "turn.terminal");
      assert.include(JSON.stringify(continued), "Background work finished.");
      const terminal = continued.at(-1)!;
      if (terminal.type !== "turn.terminal") throw new Error("Missing continuation terminal");
      assert.equal(terminal.status, "completed");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect.each(["approval-required", "full-access"] as const)(
    "continues an agy permission request after the prompt settles (%s)",
    (runtimeMode) =>
      Effect.gen(function* () {
        const gate = makeProviderReplayGate(["wake", "reply"]);
        const session = yield* openClaudeReplaySession(
          [
            {
              type: "expect_outbound",
              frame: { kind: "request", method: "initialize", params: "<any>" },
            },
            {
              type: "emit_inbound",
              frame: {
                kind: "response",
                method: "initialize",
                result: {
                  protocolVersion: 1,
                  agentInfo: { name: "Antigravity ACP Server", version: "1.5.9" },
                  agentCapabilities: { loadSession: true },
                  authMethods: [],
                },
              },
            },
            claudeFrames.open[2],
            claudeFrames.open[3],
            claudeFrames.prompt(1)[0],
            {
              type: "emit_inbound",
              frame: {
                kind: "response",
                method: "session/prompt",
                result: { stopReason: "end_turn" },
              },
            },
            {
              type: "emit_inbound",
              label: "wake",
              frame: {
                kind: "request",
                method: "session/request_permission",
                params: {
                  sessionId: CLAUDE_ROOT_SESSION,
                  toolCall: {
                    toolCallId: "late-command",
                    title: "Run command",
                    kind: "execute",
                    status: "pending",
                  },
                  options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
                },
              },
            },
            claudeMarker("late permission received"),
            {
              type: "expect_outbound",
              frame: {
                kind: "response",
                method: "session/request_permission",
                result: { outcome: { outcome: "selected", optionId: "allow" } },
              },
            },
            {
              ...claudeFrames.update(CLAUDE_ROOT_SESSION, {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "Command approved." },
              }),
              label: "reply",
            },
            claudeFrames.update(CLAUDE_ROOT_SESSION, {
              sessionUpdate: "usage_update",
              used: 100,
              size: 1000,
            }),
            claudeMarker("reply ended"),
          ],
          gate,
          true,
          { commandPath: "/root/.local/bin/agy", commandArgs: ["acp"] },
          undefined,
          runtimeMode,
        );
        yield* session.runtime.startTurn(session.turnInput(1));
        assert.equal((yield* session.terminal).status, "completed");
        gate.release("wake");
        yield* session.throughMarker("late permission received");
        assert.lengthOf(session.offers, 1, "a permission request must offer a continuation");
        yield* session.offers[0]!.dispatchIfCurrent!(Effect.void);
        yield* session.runtime.startTurn(session.turnInput(2, { continuation: true }));
        if (runtimeMode === "approval-required") {
          const events = yield* session.until(
            (event) =>
              event.type === "runtime_request.updated" && event.runtimeRequest.status === "pending",
          );
          const request = events.at(-1)!;
          if (request.type !== "runtime_request.updated") throw new Error("Missing approval");
          yield* TestClock.adjust("5 seconds");
          yield* session.runtime.respondToRuntimeRequest({
            requestId: request.runtimeRequest.id,
            decision: "accept",
          });
        }
        // The model can be silent longer than the finalize debounce before it goes on.
        yield* TestClock.adjust("10 seconds");
        gate.release("reply");
        // The closing usage_update must be handled before the clock moves, or its debounce never fires.
        const output = yield* session.throughMarker("reply ended");
        assert.isTrue(
          output.some(
            (event) =>
              event.type === "message.updated" && event.message.text === "Command approved.",
          ),
        );
        assert.isFalse(output.some((event) => event.type === "turn.terminal"));
        yield* TestClock.adjust("3 seconds");
        assert.equal((yield* session.terminal).status, "completed");
      }).pipe(Effect.provide(layerTest)),
  );

  it("preserves and sanitizes structured ACP errors without exposing arbitrary defects", () => {
    const limit = new EffectAcpErrors.AcpRequestError({
      code: -31001,
      errorMessage: "Rate limit exceeded for mistral (model: mistral-vibe-cli-latest).",
    });
    assert.deepEqual(acpRegistryPromptFailure("mistral-vibe", limit), {
      class: "usage_limit",
      message: limit.errorMessage,
      code: "-31001",
      retryable: null,
    });
    assert.equal(acpRegistryPromptFailure("other-agent", limit).class, "provider_error");
    assert.equal(
      acpRegistryPromptFailure("mistral-vibe", new Error("private defect")).message,
      "Provider turn failed.",
    );
    const rejected = acpRegistryPromptFailure(
      "any-agent",
      new EffectAcpErrors.AcpRequestError({
        code: -32603,
        errorMessage: "Request rejected. api_key=private-key https://example.test/?token=secret",
      }),
    );
    assert.include(rejected.message, "Request rejected.");
    assert.notInclude(rejected.message, "private-key");
    assert.notInclude(rejected.message, "token=secret");
  });

  describe("the agent's own pickers", () => {
    type Frame = Record<string, unknown>;
    const outbound = (method: string, params: unknown = "<any>"): Frame => ({
      type: "expect_outbound",
      frame: { kind: "request", method, params },
    });
    const answer = (method: string, result: unknown): Frame => ({
      type: "emit_inbound",
      frame: { kind: "response", method, result },
    });
    const permissionModeOption = (currentValue: string) => ({
      id: "permission-mode",
      name: "Permission mode",
      category: "mode",
      type: "select",
      currentValue,
      options: ["ask", "auto"].map((value) => ({ value, name: value })),
    });

    const openWithStoredPicks = Effect.fn("openWithStoredPicks")(function* (input: {
      readonly setup: unknown;
      readonly pickFrames: ReadonlyArray<Frame>;
      readonly agentId?: string;
      readonly customModels?: ReadonlyArray<string>;
      readonly storedModel?: string;
      readonly storedModePick?: string;
      readonly turnModels?: ReadonlyArray<string>;
      readonly rejectedModel?: string;
      readonly storedOptions?: ReadonlyArray<{ readonly id: string; readonly value: string }>;
      readonly failsConfiguration?: boolean;
      readonly liveConfiguration?: AcpRegistryLiveConfiguration;
    }) {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      // Scope release gives the replay agent at most a second to exit, so the status
      // read below waits for the agent itself instead of racing its last write.
      const agentExits: Array<Effect.Effect<void>> = [];
      const childProcessSpawner = ChildProcessSpawner.make((command) =>
        spawner
          .spawn(command)
          .pipe(
            Effect.tap((handle) =>
              Effect.sync(() => agentExits.push(Effect.ignore(handle.exitCode))),
            ),
          ),
      );
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const replayDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "orbi-acp-registry-stored-picks-",
      });
      const statusPath = path.join(replayDir, "status.json");
      const transcript = yield* decodeAcpReplayTranscript(
        {
          provider: ACP_REGISTRY_PROVIDER,
          protocol: "acp.ndjson-jsonrpc",
          version: "1",
          scenario: "stored-picks",
          entries: [
            outbound("initialize"),
            answer("initialize", {
              protocolVersion: 1,
              agentCapabilities: { loadSession: false },
              authMethods: [{ id: "test", name: "Test" }],
            }),
            outbound("session/new"),
            answer("session/new", { sessionId: "agent-session", ...(input.setup as object) }),
            ...input.pickFrames,
          ] as never,
        },
        ACP_REGISTRY_PROVIDER,
      );
      const instanceId = ProviderInstanceId.make("acp-registry-stored-picks");
      let published: AcpRegistryLiveConfiguration | undefined;
      const adapter = yield* makeAcpRegistryAdapterV2({
        selfInvocation: yield* resolveSelfInvocation(),
        instanceId,
        settings: yield* decodeAcpRegistryAdapterSettings({
          agentId: input.agentId ?? "fixture-agent",
          authMethodId: "test",
          customModels: input.customModels ?? [],
        }),
        environment: {},
        makeRuntime: makeAcpReplayRuntime({
          customModels: input.customModels,
          transcript,
          statusPath,
          scriptPath: yield* path.fromFileUrl(
            new URL("../../../scripts/acp-replay-agent.ts", import.meta.url),
          ),
          childProcessSpawner,
          fileSystem,
        }),
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            layerInjectedRuntimeCatalog,
            Layer.mock(AcpRegistryRuntimeCoordinator.AcpRegistryRuntimeCoordinator)({
              withForegroundStartup: (_startupKey, effect) => effect,
              getLiveConfiguration: () =>
                Effect.sync(() => Option.fromUndefinedOr(published ?? input.liveConfiguration)),
              publishLiveConfiguration: (_instanceId, configuration) =>
                Effect.sync(() => {
                  published = configuration;
                }),
            }),
          ),
        ),
      );
      const threadId = ThreadId.make("thread-acp-registry-stored-picks");
      const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "approval-required",
        interactionMode: "default",
        cwd: replayDir,
      });
      const stored: ModelSelection = {
        instanceId,
        model: input.storedModel ?? "default",
        ...(input.storedModePick === undefined
          ? {}
          : { options: [{ id: ACP_SESSION_MODE_OPTION_ID, value: input.storedModePick }] }),
        ...(input.storedOptions === undefined ? {} : { options: input.storedOptions }),
      };
      const configurations: Array<AcpRegistryLiveConfiguration | undefined> = [];
      yield* Effect.gen(function* () {
        const runtime = yield* adapter.openSession({
          threadId,
          providerSessionId: ProviderSessionId.make("provider-session-stored-picks"),
          modelSelection: stored,
          runtimePolicy,
        });
        configurations.push(published);
        if (input.turnModels === undefined) return;
        const providerThread = yield* runtime.ensureThread({
          threadId,
          modelSelection: stored,
          runtimePolicy,
        });
        const now = yield* DateTime.now;
        let current = stored;
        for (const [index, model] of input.turnModels.entries()) {
          const target: ModelSelection = { instanceId, model };
          const plan = yield* adapter.planSelectionTransition({
            current,
            target,
            sessionCapabilities: runtime.providerSession.capabilities,
          });
          assert.equal(plan.type, "apply_on_next_turn");
          yield* runtime.startTurn(
            makeTurnInput({
              threadId,
              providerThread,
              instanceId,
              runtimePolicy,
              now,
              ordinal: index + 1,
              modelSelection: target,
            }),
          );
          yield* runtime.events.pipe(
            Stream.takeUntil((event) => event.type === "turn.terminal"),
            Stream.runForEach((event) =>
              Effect.sync(() => {
                if (event.type === "turn.terminal") {
                  assert.equal(event.status, "completed", event.failure?.message);
                }
              }),
            ),
          );
          configurations.push(published);
          current = target;
        }
      }).pipe(
        Effect.match({
          onFailure: (error) => {
            if (input.failsConfiguration === true) return;
            assert.isDefined(input.rejectedModel);
            assert.equal(
              makeProviderFailure({ cause: error }).message,
              `The agent did not accept the model "${input.rejectedModel}". Choose another model for this provider, then retry.`,
            );
          },
          onSuccess: () => {
            assert.isUndefined(input.rejectedModel);
            assert.notEqual(input.failsConfiguration, true, "configuration should have failed");
          },
        }),
        Effect.scoped,
      );
      yield* Effect.all(agentExits, { discard: true });
      yield* makeAcpReplayCompletenessAssertion(fileSystem, statusPath, transcript);
      return { configurations };
    });

    it.effect("switches an agent that only advertises modes with session/set_mode", () =>
      openWithStoredPicks({
        setup: {
          modes: {
            currentModeId: "default",
            availableModes: ["default", "autoEdit"].map((id) => ({ id, name: id })),
          },
        },
        pickFrames: [
          outbound("session/set_mode", { sessionId: "agent-session", modeId: "autoEdit" }),
          answer("session/set_mode", {}),
        ],
        storedModePick: "autoEdit",
      }).pipe(Effect.provide(layerTest)),
    );

    it.effect("switches a mode config option under its own id", () =>
      openWithStoredPicks({
        setup: { configOptions: [permissionModeOption("ask")] },
        pickFrames: [
          outbound("session/set_config_option", {
            sessionId: "agent-session",
            configId: "permission-mode",
            value: "auto",
          }),
          answer("session/set_config_option", { configOptions: [permissionModeOption("auto")] }),
        ],
        storedModePick: "auto",
      }).pipe(Effect.provide(layerTest)),
    );

    const modelOption = (id: string, currentValue: string, grouped = false) => ({
      id,
      name: "Model",
      category: "model",
      type: "select",
      currentValue,
      options: grouped
        ? [{ group: "models", name: "Models", options: [{ value: "default", name: "Default" }] }]
        : [{ value: "auto", name: "Auto" }],
    });
    const configOptionUpdate = (configOptions: ReadonlyArray<unknown>): Frame => ({
      type: "emit_inbound",
      frame: {
        kind: "notification",
        method: "session/update",
        params: {
          sessionId: "agent-session",
          update: { sessionUpdate: "config_option_update", configOptions },
        },
      },
    });
    const prompt = (...updates: ReadonlyArray<Frame>): ReadonlyArray<Frame> => [
      outbound("session/prompt"),
      ...updates,
      answer("session/prompt", { stopReason: "end_turn" }),
    ];
    const setModel = (modelId: string): ReadonlyArray<Frame> => [
      outbound("session/set_model", { sessionId: "agent-session", modelId }),
      answer("session/set_model", {}),
    ];

    it.effect(
      "discovers session models and switches through live model configuration changes",
      () =>
        Effect.gen(function* () {
          const flatOption = (current: string) => modelOption("live-model", current);
          const groupedOption = (current: string) =>
            modelOption("replacement-model", current, true);
          const { configurations } = yield* openWithStoredPicks({
            setup: {
              models: {
                currentModelId: "hermes",
                availableModels: ["hermes", "auto", "default"].map((modelId) => ({
                  modelId,
                  name: modelId,
                })),
              },
            },
            customModels: ["custom-model"],
            storedModel: "default",
            turnModels: [
              "hermes",
              "custom-model",
              "auto",
              "default",
              "hermes",
              "custom-model",
              "auto",
              "custom-model",
              "default",
              "hermes",
            ],
            pickFrames: [
              ...setModel("default"),
              ...setModel("hermes"),
              ...prompt(),
              ...setModel("custom-model"),
              ...prompt(),
              ...setModel("auto"),
              ...prompt(),
              ...setModel("default"),
              ...prompt(),
              ...setModel("hermes"),
              ...prompt(configOptionUpdate([flatOption("hermes")])),
              outbound("session/set_config_option", {
                sessionId: "agent-session",
                configId: "live-model",
                value: "custom-model",
              }),
              answer("session/set_config_option", { configOptions: [flatOption("custom-model")] }),
              ...prompt(),
              outbound("session/set_config_option", {
                sessionId: "agent-session",
                configId: "live-model",
                value: "auto",
              }),
              answer("session/set_config_option", { configOptions: [flatOption("auto")] }),
              ...prompt(configOptionUpdate([groupedOption("auto")])),
              outbound("session/set_config_option", {
                sessionId: "agent-session",
                configId: "replacement-model",
                value: "custom-model",
              }),
              answer("session/set_config_option", {
                configOptions: [groupedOption("custom-model")],
              }),
              ...prompt(),
              outbound("session/set_config_option", {
                sessionId: "agent-session",
                configId: "replacement-model",
                value: "default",
              }),
              answer("session/set_config_option", { configOptions: [groupedOption("default")] }),
              ...prompt(configOptionUpdate([])),
              ...setModel("hermes"),
              ...prompt(),
            ],
          });
          assert.deepEqual(
            configurations.map((configuration) => ({
              models: configuration?.models.map((model) => model.id),
              current: configuration?.currentModelId,
            })),
            [
              { models: ["hermes", "auto", "default"], current: "default" },
              { models: ["hermes", "auto", "default"], current: "hermes" },
              { models: ["hermes", "auto", "default"], current: null },
              { models: ["hermes", "auto", "default"], current: "auto" },
              { models: ["hermes", "auto", "default"], current: "default" },
              { models: ["auto"], current: null },
              { models: ["auto"], current: null },
              { models: ["default"], current: null },
              { models: ["default"], current: null },
              { models: ["hermes", "auto", "default"], current: "default" },
              { models: ["hermes", "auto", "default"], current: "hermes" },
            ],
          );
        }).pipe(Effect.provide(layerTest)),
    );

    it.effect.each([
      "config",
      "legacy",
      "updated-config",
      "removed-config",
      "configuration-update",
      "unavailable-before-configuration",
    ] as const)(
      "rejects an unavailable explicit model in a %s catalog before inference",
      (catalog) => {
        const duringTurn = catalog === "updated-config" || catalog === "removed-config";
        const duringConfiguration = catalog === "configuration-update";
        const changesOptions =
          duringConfiguration || catalog === "unavailable-before-configuration";
        const model = duringTurn || duringConfiguration ? "hermes" : "missing";
        const restrictedOption = {
          ...modelOption("model", "other"),
          options: [{ value: "other", name: "Other" }],
        };
        return openWithStoredPicks({
          setup: {
            ...(catalog === "legacy" || catalog === "removed-config"
              ? {
                  models: {
                    currentModelId: "other",
                    availableModels: [{ modelId: "other", name: "Other" }],
                  },
                }
              : {}),
            configOptions:
              catalog === "legacy"
                ? []
                : [
                    {
                      ...modelOption("model", "hermes"),
                      options: [{ value: "hermes", name: "Hermes" }],
                    },
                    ...(changesOptions ? [permissionModeOption("ask")] : []),
                  ],
          },
          storedModel: model,
          ...(duringTurn ? { turnModels: [model, model] } : {}),
          ...(changesOptions ? { storedModePick: "auto" } : {}),
          rejectedModel: model,
          pickFrames: duringTurn
            ? prompt(configOptionUpdate(catalog === "removed-config" ? [] : [restrictedOption]))
            : duringConfiguration
              ? [
                  outbound("session/set_config_option", {
                    sessionId: "agent-session",
                    configId: "permission-mode",
                    value: "auto",
                  }),
                  answer("session/set_config_option", {
                    configOptions: [restrictedOption, permissionModeOption("auto")],
                  }),
                ]
              : [],
        }).pipe(Effect.provide(layerTest));
      },
    );

    // regression: #19519 models come from session model state, not a hardcoded list
    it.effect("keeps unadvertised default and auto selections agent-controlled", () =>
      Effect.gen(function* () {
        const { configurations } = yield* openWithStoredPicks({
          setup: {
            models: {
              currentModelId: "hermes",
              availableModels: ["hermes", "other"].map((modelId) => ({ modelId, name: modelId })),
            },
          },
          storedModel: "default",
          turnModels: ["auto", "default", "other", "default", "auto", "default", "auto"],
          pickFrames: [
            ...prompt(),
            ...prompt(),
            ...setModel("other"),
            ...prompt(
              configOptionUpdate([
                {
                  ...modelOption("live-model", "other"),
                  options: [{ value: "other", name: "Other" }],
                },
              ]),
            ),
            ...prompt(),
            ...prompt(),
            ...prompt(
              configOptionUpdate([
                {
                  ...modelOption("replacement-model", "other", true),
                  options: [
                    {
                      group: "models",
                      name: "Models",
                      options: [{ value: "other", name: "Other" }],
                    },
                  ],
                },
              ]),
            ),
            ...prompt(),
          ],
        });
        assert.deepEqual(
          configurations.map((configuration) => configuration?.currentModelId),
          ["hermes", "hermes", "hermes", "other", "other", "other", "other", "other"],
        );
      }).pipe(Effect.provide(layerTest)),
    );
    it.effect(
      "fails configuration when an option write errors for a reason other than refusal",
      () => {
        const sessionModel = (currentValue: string) => ({
          ...modelOption("model", currentValue),
          options: ["default", "named"].map((value) => ({ value, name: value })),
        });
        const thinking = {
          id: "thinking",
          name: "Thinking",
          category: "thought_level",
          type: "select",
          currentValue: "low",
          options: ["low", "high"].map((value) => ({ value, name: value })),
        };
        return openWithStoredPicks({
          setup: { configOptions: [sessionModel("default")] },
          storedModel: "named",
          storedOptions: [
            { id: "thinking", value: "high" },
            { id: "unavailable", value: "x" },
          ],
          failsConfiguration: true,
          pickFrames: [
            outbound("session/set_config_option", {
              sessionId: "agent-session",
              configId: "model",
              value: "named",
            }),
            answer("session/set_config_option", {
              configOptions: [sessionModel("named"), thinking],
            }),
            outbound("session/set_config_option", {
              sessionId: "agent-session",
              configId: "thinking",
              value: "high",
            }),
            {
              type: "emit_inbound",
              frame: {
                kind: "response",
                method: "session/set_config_option",
                error: { code: -32603, message: "Internal error" },
              },
            },
          ],
        }).pipe(Effect.provide(layerTest));
      },
    );
    const modelOptions = [
      { id: "fast", name: "Fast", category: "model", type: "boolean", currentValue: false },
      {
        id: " ",
        name: "Unnamed",
        category: "model",
        type: "select",
        currentValue: "unaddressable",
        options: [{ value: "unaddressable", name: "Unaddressable" }],
      },
      {
        id: "provider",
        name: "Provider",
        category: "model",
        type: "select",
        currentValue: "gateway",
        options: [
          {
            group: "hosted",
            name: "Hosted",
            options: [
              { value: "gateway", name: "Gateway" },
              { value: "codex", name: "Codex" },
            ],
          },
        ],
      },
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "later-model",
        options: [{ value: "later-model", name: "Later model" }],
      },
    ] as const;

    it.effect("opens a model from the catalog by writing the first usable model select", () =>
      Effect.gen(function* () {
        const setup = { sessionId: "agent-session", configOptions: modelOptions };
        const catalog = acpRegistryProbeResult(ProviderInstanceId.make("acp-registry-mode-pick"), {
          sessionId: setup.sessionId,
          initializeResult: { protocolVersion: 1 },
          sessionSetupResult: {
            ...setup,
            // The catalog uses the normalized groupId; ACP v1 sends group on the wire.
            configOptions: modelOptions.map((option) =>
              option.id === "provider"
                ? {
                    ...option,
                    options: [{ ...option.options[0], groupId: option.options[0].group }],
                  }
                : option,
            ),
          },
          modelConfigId: "provider",
        });
        assert.deepEqual(catalog.models, [
          { id: "gateway", name: "Gateway", description: null },
          { id: "codex", name: "Codex", description: null },
        ]);
        assert.equal(catalog.currentModelId, "gateway");
        const model = catalog.models[1]?.id;
        assert.isDefined(model);
        const opened = yield* openWithStoredPicks({
          setup,
          pickFrames: [
            outbound("session/set_config_option", {
              sessionId: "agent-session",
              configId: "provider",
              value: "codex",
            }),
            answer("session/set_config_option", {
              configOptions: modelOptions.map((option) =>
                option.id === "provider" ? { ...option, currentValue: "codex" } : option,
              ),
            }),
          ],
          storedModel: model,
        });
        assert.equal(opened.configurations.at(-1)?.currentModelId, "codex");
      }).pipe(Effect.provide(layerTest)),
    );
  });

  it.effect("gives HTTP-capable agents Orbi's MCP server over HTTP", () =>
    Effect.gen(function* () {
      const selfInvocation = yield* resolveSelfInvocation();
      const mockAgentPath = yield* (yield* Path.Path).fromFileUrl(
        new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
      );
      const mcpSessions = yield* McpProviderSessions.McpProviderSessions;
      const endpoint = "http://127.0.0.1:43123/mcp";
      const sessionMcpServers = Effect.fn("sessionMcpServers")(function* (
        config: Record<string, unknown>,
        agentEnvironment: Record<string, string> = {},
      ) {
        const requests: Array<AcpSessionRuntime.AcpSessionRequestLogEvent> = [];
        const instanceId = ProviderInstanceId.make("acp-registry-mcp-transport");
        const threadId = ThreadId.make("thread-acp-registry-mcp-transport");
        const mcpSession = {
          environmentId: EnvironmentId.make("environment-acp-registry-mcp-transport"),
          threadId,
          providerSessionId: "mcp-session-acp-registry-mcp-transport",
          providerInstanceId: instanceId,
          endpoint,
          browserToolsAvailable: false,
        };
        yield* mcpSessions.set({ ...mcpSession, authorizationHeader: "Bearer opened-token" });
        const adapter = yield* makeAcpRegistryAdapterV2({
          selfInvocation,
          instanceId,
          settings: yield* decodeAcpRegistryAdapterSettings(config),
          environment: {},
          nativeLogging: () => ({
            requestLogger: (event) =>
              Effect.sync(() => {
                if (event.status === "started") requests.push(event);
              }),
          }),
        }).pipe(
          Effect.provide(
            Layer.mock(AcpRegistrySupport.AcpRegistryCatalog)({
              resolve: () =>
                Effect.succeed({
                  distribution: "local" as const,
                  spawn: {
                    command: process.execPath,
                    args: [mockAgentPath],
                    env: { ORBI_ACP_SESSION_LIFECYCLE: "1", ...agentEnvironment },
                  },
                }),
            }),
          ),
        );
        const modelSelection = { instanceId, model: "default" } as const;
        const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
          runtimeMode: "full-access",
          interactionMode: "default",
          cwd: process.cwd(),
        });
        const runtime = yield* adapter.openSession({
          threadId,
          providerSessionId: ProviderSessionId.make("provider-session-acp-registry-mcp-transport"),
          modelSelection,
          runtimePolicy,
        });
        const providerThread = yield* runtime.ensureThread({
          threadId,
          modelSelection,
          runtimePolicy,
        });
        yield* mcpSessions.set({ ...mcpSession, authorizationHeader: "Bearer rotated-token" });
        yield* runtime.resumeThread({
          providerThread: {
            ...providerThread,
            nativeThreadRef: {
              driver: ACP_REGISTRY_PROVIDER,
              nativeId: "mock-session-2",
              strength: "strong",
            },
          },
        });
        const sent = (method: string) => {
          const payload = requests.find((event) => event.method === method)?.payload;
          return typeof payload === "object" && payload !== null
            ? Reflect.get(payload, "mcpServers")
            : undefined;
        };
        return { new: sent("session/new"), load: sent("session/load") };
      });
      const plainHttp = (authorization: string) => [
        {
          type: "http",
          name: "orbiwork",
          url: endpoint,
          headers: [{ name: "Authorization", value: authorization }],
        },
      ];
      const stdio = (authorization: string) => [
        {
          name: "orbiwork",
          command: selfInvocation.command,
          args: [...selfInvocationArgs(selfInvocation, ["acp-mcp-bridge"])],
          env: [
            { name: "ELECTRON_RUN_AS_NODE", value: "1" },
            { name: "ORBI_ACP_MCP_ENDPOINT", value: endpoint },
            { name: "ORBI_ACP_MCP_AUTHORIZATION", value: authorization },
          ],
        },
      ];

      // Command Code cannot start the stdio bridge on Windows: it spawns MCP commands through
      // cmd.exe, which splits the unquoted Orbi executable path at the space.
      const commandCode = {
        commandPath: "C:\\tools\\cmdc.exe",
        commandArgs: ["acp"],
      };
      assert.deepEqual(yield* sessionMcpServers(commandCode, { ORBI_ACP_MCP_HTTP: "1" }), {
        new: plainHttp("Bearer opened-token"),
        load: plainHttp("Bearer rotated-token"),
      });
      assert.deepEqual(yield* sessionMcpServers(commandCode), {
        new: stdio("Bearer opened-token"),
        load: stdio("Bearer rotated-token"),
      });
      // Any other local agent keeps the stdio bridge.
      assert.deepEqual(
        yield* sessionMcpServers(
          { commandPath: "C:\\tools\\node.exe", commandArgs: ["agent.mjs"] },
          { ORBI_ACP_MCP_HTTP: "1" },
        ),
        { new: stdio("Bearer opened-token"), load: stdio("Bearer rotated-token") },
      );
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("the agent process env names the thread it serves", () =>
    Effect.gen(function* () {
      const selfInvocation = yield* resolveSelfInvocation();
      const mockAgentPath = yield* (yield* Path.Path).fromFileUrl(
        new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
      );
      const endpoint = "http://127.0.0.1:43123/mcp";
      const instanceId = ProviderInstanceId.make("acp-registry-thread-env");
      const threadId = ThreadId.make("thread-acp-registry-thread-env");
      yield* (yield* McpProviderSessions.McpProviderSessions).set({
        environmentId: EnvironmentId.make("environment-acp-registry-thread-env"),
        threadId,
        providerSessionId: "mcp-session-acp-registry-thread-env",
        providerInstanceId: instanceId,
        endpoint,
        authorizationHeader: "Bearer thread-env-token",
        browserToolsAvailable: false,
      });
      // Several agents can run from one directory at once; the spawn env is how
      // a process the agent starts (an MCP server, a shell tool) finds its own
      // Orbi thread, the same way Claude and Codex sessions do.
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const spawnEnvironments: Array<Record<string, unknown> | undefined> = [];
      const capturingSpawner = ChildProcessSpawner.make((command) =>
        Effect.sync(() => {
          if (command._tag === "StandardCommand") spawnEnvironments.push(command.options.env);
        }).pipe(Effect.andThen(spawner.spawn(command))),
      );
      const withCapturedSpawns = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, capturingSpawner),
        );
      const adapter = yield* withCapturedSpawns(
        makeAcpRegistryAdapterV2({
          selfInvocation,
          instanceId,
          settings: yield* decodeAcpRegistryAdapterSettings({ agentId: "claude-acp" }),
          environment: {},
        }).pipe(
          Effect.provide(
            Layer.mock(AcpRegistrySupport.AcpRegistryCatalog)({
              resolve: () =>
                Effect.succeed({
                  distribution: "local" as const,
                  spawn: {
                    command: process.execPath,
                    args: [mockAgentPath],
                    env: { ORBI_ACP_SESSION_LIFECYCLE: "1" },
                  },
                }),
            }),
          ),
        ),
      );
      const modelSelection = { instanceId, model: "default" } as const;
      const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: process.cwd(),
      });
      const runtime = yield* withCapturedSpawns(
        adapter.openSession({
          threadId,
          providerSessionId: ProviderSessionId.make("provider-session-acp-registry-thread-env"),
          modelSelection,
          runtimePolicy,
        }),
      );
      yield* withCapturedSpawns(runtime.ensureThread({ threadId, modelSelection, runtimePolicy }));
      const agentEnvironment = spawnEnvironments.find(
        (environment) => environment?.ORBI_ACP_SESSION_LIFECYCLE === "1",
      );
      assert.isDefined(agentEnvironment, "the agent itself must have been spawned");
      assert.equal(agentEnvironment?.ORBIWORK_THREAD_ID, "thread-acp-registry-thread-env");
      assert.equal(agentEnvironment?.ORBI_ACP_MCP_ENDPOINT, endpoint);
      assert.equal(agentEnvironment?.ORBI_ACP_MCP_AUTHORIZATION, "Bearer thread-env-token");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect.each(["before", "after"] as const)(
    "reconciles a full prompt echo %s acknowledgment",
    (ordering) =>
      Effect.gen(function* () {
        const runtimeInstructions = {
          type: "text",
          text: buildRuntimeInstructions({ harness: "acpRegistry", model: "default" }),
        };
        const promptBlocks = (ordinal: number) => [
          {
            type: "text",
            text:
              ordinal === 1
                ? orbiAcpPromptWithInstructions({
                    prompt: "test prompt",
                    state: { interactionMode: "default", hasOrbiMcp: false, hasDeviceTools: false },
                  })
                : "test prompt",
          },
          ...(ordinal === 1 ? [runtimeInstructions] : []),
        ];
        const echo = (messageId: string, content: ReadonlyArray<unknown>) =>
          claudeFrames.update(CLAUDE_ROOT_SESSION, {
            sessionUpdate: "user_message",
            messageId,
            content,
          });
        const promptText = (ordinal: number) =>
          promptBlocks(ordinal)
            .map((block) => block.text)
            .join("\n");
        const frames = (ordinal: number) => {
          const [request, , acknowledgment] = claudeFrames.prompt(ordinal);
          const matching = echo(`echo-${ordinal}`, promptBlocks(ordinal));
          return [
            request,
            echo("different-blocks", [
              {
                type: "text",
                text: promptText(ordinal),
                annotations: { audience: ["user"] },
              },
            ]),
            ...(ordering === "before" ? [matching, acknowledgment] : [acknowledgment, matching]),
            claudeFrames.update(CLAUDE_ROOT_SESSION, {
              sessionUpdate: "user_message_chunk",
              messageId: `echo-${ordinal}`,
              content: { type: "text", text: "updated echo" },
            }),
            echo(`echo-${ordinal}`, [{ type: "text", text: "updated echo" }]),
            echo("second-id", promptBlocks(ordinal)),
            echo("unmatched", [{ type: "text", text: "Continue the review." }]),
            claudeFrames.idle("end_turn"),
          ];
        };
        const session = yield* openClaudeReplaySession(
          [
            ...claudeFrames.open,
            ...frames(1),
            ...frames(2),
            claudeFrames.closeRequest,
            claudeFrames.closed,
          ],
          undefined,
          false,
        );
        for (const ordinal of [1, 2]) {
          yield* session.runtime.startTurn(session.turnInput(ordinal));
          const events = yield* session.until((event) => event.type === "turn.terminal");
          const messages = events.flatMap((event) =>
            event.type === "message.updated" && event.message.role === "user"
              ? [event.message]
              : [],
          );
          const items = events.flatMap((event) =>
            event.type === "turn_item.updated" && event.turnItem.type === "user_message"
              ? [event.turnItem]
              : [],
          );
          const expected = new Set([promptText(ordinal), "Continue the review."]);
          assert.deepEqual(new Set(messages.map((message) => message.text)), expected);
          assert.equal(new Set(messages.map((message) => message.id)).size, 3);
          assert.equal(new Set(items.map((item) => item.id)).size, 3);
          for (const id of ["different-blocks", "second-id", "unmatched"]) {
            assert.isTrue(
              items.some((item) => item.nativeItemRef?.nativeId?.endsWith(`:user:message:${id}`)),
              `${id} remains visible`,
            );
          }
        }
      }).pipe(Effect.provide(layerTest)),
  );

  // regression: #38599 Hermes replies on its own when a background process it started exits
  it.effect.each([
    { launch: "hermes acp", commandPath: "hermes", commandArgs: ["acp"] },
    { launch: "a wrapper", commandPath: "node", commandArgs: ["hermes-acp.mjs"] },
  ])("does not drop Hermes' reply after a background process finishes ($launch)", (launch) =>
    Effect.gen(function* () {
      const gate = makeProviderReplayGate(["process-exit"]);
      const sessionId = "hermes-session";
      const update = (sessionUpdate: Record<string, unknown>) =>
        claudeFrames.update(sessionId, sessionUpdate);
      const session = yield* openClaudeReplaySession(
        [
          {
            type: "expect_outbound",
            frame: { kind: "request", method: "initialize", params: "<any>" },
          },
          {
            type: "emit_inbound",
            frame: {
              kind: "response",
              method: "initialize",
              result: {
                protocolVersion: 1,
                agentInfo: { name: "hermes-agent", version: "0.23.1" },
                agentCapabilities: { loadSession: true },
                authMethods: [],
              },
            },
          },
          {
            type: "expect_outbound",
            frame: { kind: "request", method: "session/new", params: "<any>" },
          },
          {
            type: "emit_inbound",
            frame: { kind: "response", method: "session/new", result: { sessionId } },
          },
          {
            type: "expect_outbound",
            frame: { kind: "request", method: "session/prompt", params: "<any>" },
          },
          update({
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Started it in the background." },
          }),
          {
            type: "emit_inbound",
            frame: {
              kind: "response",
              method: "session/prompt",
              result: { stopReason: "end_turn" },
            },
          },
          {
            ...update({
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "The background command printed DONE" },
            }),
            label: "process-exit",
          },
          update({ sessionUpdate: "session_info_update", title: "after completion reply" }),
        ],
        gate,
        true,
        { commandPath: launch.commandPath, commandArgs: launch.commandArgs },
      );
      yield* session.runtime.startTurn(session.turnInput(1));
      const foreground = yield* session.until((event) => event.type === "turn.terminal");
      assert.include(JSON.stringify(foreground.at(-1)), '"status":"completed"');
      gate.release("process-exit");
      yield* Queue.take(session.offered);
      yield* session.throughMarker("after completion reply");
      yield* session.offers[0]!.dispatchIfCurrent!(Effect.void);
      yield* session.runtime.startTurn(session.turnInput(2, { continuation: true }));
      yield* TestClock.adjust("10 seconds");
      const continuation = yield* session.until((event) => event.type === "turn.terminal");
      assert.include(JSON.stringify(continuation), "printed DONE");
      assert.include(JSON.stringify(continuation.at(-1)), '"status":"completed"');
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("protects Hermes background work when a wrapper launches it on replacement", () =>
    Effect.gen(function* () {
      const gate = makeProviderReplayGate(["process-exit"]);
      const request = (method: string) => ({
        type: "expect_outbound",
        frame: { kind: "request", method, params: "<any>" },
      });
      const respond = (method: string, result: object) => ({
        type: "emit_inbound",
        frame: { kind: "response", method, result },
      });
      const open = (sessionId: string, name: string) => [
        request("initialize"),
        respond("initialize", { protocolVersion: 1, agentInfo: { name, version: "1.0.0" } }),
        request("session/new"),
        respond("session/new", { sessionId }),
      ];
      const sessionId = "hermes-replacement";
      const session = yield* openClaudeReplaySession(
        open("initial-session", "generic-agent"),
        gate,
        true,
        { commandPath: "node", commandArgs: ["agent-wrapper.mjs"] },
        [
          ...open(sessionId, "hermes-agent"),
          request("session/prompt"),
          respond("session/prompt", { stopReason: "end_turn" }),
          {
            ...claudeFrames.update(sessionId, {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Background command finished" },
            }),
            label: "process-exit",
          },
        ],
      );
      const { threadId, modelSelection, runtimePolicy } = session.turnInput(1);
      const replaceThread = {
        threadId,
        modelSelection,
        runtimePolicy,
        forceNewNativeThread: true,
      };
      const pendingWork = session.runtime.hasPendingBackgroundWork ?? Effect.succeed(false);
      assert.isFalse(yield* pendingWork);
      const providerThread = yield* session.runtime.ensureThread(replaceThread);
      yield* session.runtime.startTurn({ ...session.turnInput(1), providerThread });
      assert.equal((yield* session.terminal).status, "completed");

      gate.release("process-exit");
      yield* Queue.take(session.offered);
      assert.isTrue(yield* pendingWork);
      const error = yield* session.runtime.ensureThread(replaceThread).pipe(Effect.flip);
      assert.include(String(error.cause), "background work is active");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("replaces streamed root tool output with a later content list", () =>
    Effect.gen(function* () {
      const { update } = claudeFrames;
      const text = (value: string) => [{ type: "content", content: { type: "text", text: value } }];
      const session = yield* openClaudeReplaySession([
        ...claudeFrames.open,
        ...claudeFrames.prompt(1),
        update(CLAUDE_ROOT_SESSION, {
          sessionUpdate: "tool_call_update",
          toolCallId: "root-tool",
          title: "Stream",
          status: "in_progress",
          content: text("one"),
        }),
        update(CLAUDE_ROOT_SESSION, {
          sessionUpdate: "tool_call_content_chunk",
          toolCallId: "root-tool",
          content: { type: "content", content: { type: "text", text: "two" } },
        }),
        update(CLAUDE_ROOT_SESSION, {
          sessionUpdate: "tool_call_update",
          toolCallId: "root-tool",
          status: "completed",
          content: text("replacement"),
        }),
        update(CLAUDE_ROOT_SESSION, {
          sessionUpdate: "tool_call_content_chunk",
          toolCallId: "root-tool",
          content: { type: "content", content: { type: "text", text: "-more" } },
        }),
        update(CLAUDE_ROOT_SESSION, {
          sessionUpdate: "tool_call_content_chunk",
          toolCallId: "root-tool",
          content: {
            type: "diff",
            changes: [{ operation: "add", path: "/a.txt" }],
            patch: { format: "git_patch", text: "PATCH" },
          },
        }),
        claudeMarker("tools complete"),
        claudeFrames.idle("end_turn"),
        claudeFrames.closeRequest,
        claudeFrames.closed,
      ]);
      yield* session.runtime.startTurn(session.turnInput(1));
      const events = yield* session.throughMarker("tools complete");
      const outputs = events.flatMap((event) =>
        event.type === "turn_item.updated" &&
        event.turnItem.nativeItemRef?.nativeId === "root-tool" &&
        "output" in event.turnItem
          ? [event.turnItem.output]
          : [],
      );
      assert.deepEqual(outputs, [
        text("one"),
        text("onetwo"),
        text("replacement"),
        text("replacement-more"),
        { type: "Text", text: "replacement-morePATCH" },
      ]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("counts per-turn usage for a local glm command", () =>
    Effect.gen(function* () {
      const session = yield* openClaudeReplaySession(
        [
          // GLM reports per-turn usage on the v1 prompt response.
          ...claudeFrames.open.map((entry) =>
            entry.frame.method === "initialize" && entry.type === "emit_inbound"
              ? {
                  ...entry,
                  frame: {
                    ...entry.frame,
                    result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] },
                  },
                }
              : entry,
          ),
          {
            type: "expect_outbound",
            frame: { kind: "request", method: "session/prompt", params: "<any>" },
          },
          {
            type: "emit_inbound",
            frame: {
              kind: "response",
              method: "session/prompt",
              result: {
                stopReason: "end_turn",
                usage: { totalTokens: 3_000, inputTokens: 2_500, outputTokens: 500 },
              },
            },
          },
          claudeFrames.closeRequest,
          claudeFrames.closed,
        ],
        undefined,
        false,
        { commandPath: "/opt/glm/bin/glm" },
      );
      yield* session.runtime.startTurn(session.turnInput(1)).pipe(Effect.forkScoped);
      const events = yield* session.until((event) => event.type === "turn.terminal");
      const completed = events.findLast(
        (event) =>
          event.type === "provider_turn.updated" && event.providerTurn.status === "completed",
      );
      assert.deepEqual(
        completed?.type === "provider_turn.updated" ? completed.providerTurn.turnTokenUsage : null,
        {
          usageScope: "main_agent",
          usageStatus: "complete",
          hasSubagents: false,
          inputTokens: 2_500,
          outputTokens: 500,
        },
      );
      const terminal = events.at(-1)!;
      if (terminal.type !== "turn.terminal") throw new Error("Missing terminal");
      assert.equal(terminal.status, "completed");
    }).pipe(Effect.provide(layerTest), Effect.scoped),
  );

  it.effect("surfaces Mistral's retry notice for a local vibe command", () =>
    Effect.gen(function* () {
      const session = yield* openClaudeReplaySession(
        [
          ...claudeFrames.open,
          {
            type: "expect_outbound",
            frame: { kind: "request", method: "session/prompt", params: "<any>" },
          },
          claudeFrames.update(CLAUDE_ROOT_SESSION, {
            sessionUpdate: "user_message",
            messageId: "user-1",
            content: [{ type: "text", text: "test prompt" }],
          }),
          claudeFrames.update(CLAUDE_ROOT_SESSION, {
            sessionUpdate: "state_update",
            state: "running",
          }),
          {
            type: "emit_inbound",
            frame: {
              kind: "notification",
              method: "_session/retrying",
              params: {
                sessionId: CLAUDE_ROOT_SESSION,
                category: "rate_limited",
                detail: "Backing off for 30s",
              },
            },
          },
          claudeMarker("retry noticed"),
          {
            type: "emit_inbound",
            frame: {
              kind: "response",
              method: "session/prompt",
              result: { stopReason: "end_turn" },
            },
          },
          claudeFrames.idle("end_turn"),
          claudeFrames.closeRequest,
          claudeFrames.closed,
        ],
        undefined,
        false,
        { commandPath: "/opt/vibe/bin/vibe-acp" },
      );
      yield* session.runtime.startTurn(session.turnInput(1));
      const events = yield* session.throughMarker("retry noticed");
      const retry = events.find(
        (event) => event.type === "turn_item.updated" && event.turnItem.type === "error",
      );
      if (retry?.type !== "turn_item.updated" || retry.turnItem.type !== "error")
        throw new Error("Missing provider retry item");
      assert.equal(retry.turnItem.title, "Provider retry");
      assert.equal(retry.turnItem.failure.class, "usage_limit");
      assert.equal(retry.turnItem.retry?.attempt, 1);
      const terminal = yield* session.terminal;
      assert.equal(terminal.status, "completed");
    }).pipe(Effect.provide(layerTest), Effect.scoped),
  );
});
