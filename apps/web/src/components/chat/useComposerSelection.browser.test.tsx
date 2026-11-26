import { scopeThreadRef } from "@orbiwork/client-runtime/environment";
import type { AtomCommandResult } from "@orbiwork/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@orbiwork/client-runtime/state/shell";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type ServerProvider,
} from "@orbiwork/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@orbiwork/contracts/settings";
import { createModelSelection } from "@orbiwork/shared/model";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

const mocks = vi.hoisted(() => ({
  setModelSelection: null as ((value: unknown) => Promise<AtomCommandResult<void, unknown>>) | null,
}));

vi.mock(import("../../state/use-orchestration-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useOrchestrationCommand: (() => (value: unknown) => mocks.setModelSelection?.(value)) as never,
}));

vi.mock(import("../../state/threads"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    environmentThreadShells: {
      ...actual.environmentThreadShells,
      threadShellAtom: ((ref: { threadId: string }) => shellAtom(ref.threadId)) as never,
    },
  };
});

import { render } from "../../../test/render";
import {
  deriveEffectiveComposerModelState,
  queuedRunEditDraftId,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { AppAtomRegistryProvider, appAtomRegistry } from "../../rpc/atomRegistry";
import { useComposerSelection } from "./useComposerSelection";

// Kept alive so a shell set before the hook mounts is still there when it saves a pick.
const shellAtom = Atom.family((_threadId: string) => Atom.make<unknown>(null).pipe(Atom.keepAlive));

function setup() {
  const setModelSelection = vi.fn<(value: unknown) => Promise<AtomCommandResult<void, unknown>>>();
  mocks.setModelSelection = setModelSelection;
  return { setModelSelection };
}

const environmentId = EnvironmentId.make("environment-local");
const agent = ProviderInstanceId.make("acpRegistry");
const stored = createModelSelection(agent, "claude-opus-5-5", [{ id: "effort", value: "medium" }]);

const providers: ReadonlyArray<ServerProvider> = [
  {
    instanceId: agent,
    driver: ProviderDriverKind.make("acpRegistry"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [{ slug: "auto-smart", name: "Auto", isCustom: false, capabilities: {} }],
    slashCommands: [],
    skills: [],
  },
];

// The hook reads only the thread's identity and stored selection.
function agentThread(id: string) {
  return { environmentId, id: ThreadId.make(id), modelSelection: stored } as EnvironmentThreadShell;
}

function Picker(props: {
  thread: EnvironmentThreadShell;
  runtime: Parameters<typeof useComposerSelection>[0]["activeRuntime"];
  model?: string;
  draftTarget?: Parameters<typeof useComposerSelection>[0]["composerDraftTarget"];
}) {
  const { onProviderModelSelectStable } = useComposerSelection({
    environmentId,
    composerDraftTarget: props.draftTarget ?? scopeThreadRef(environmentId, props.thread.id),
    draftThread: null,
    activeThread: props.thread,
    activeRuntime: props.runtime,
    activeProjectSettings: { settings: { newWorktreesStartFromOrigin: false } },
    settings: DEFAULT_UNIFIED_SETTINGS,
    providerStatuses: providers,
    lockedProvider: null,
    supportsProviderSwitchingViaHandoff: true,
    multipleModelSelections: null,
    runtimeMode: "full-access",
    isLocalDraftThread: false,
    canOverrideServerThreadEnvMode: false,
    setPendingServerThreadEnvModeEntry: () => {},
    setPendingServerThreadStartFromOriginByThreadId: () => {},
    scheduleComposerFocus: () => {},
  });
  return (
    <button
      type="button"
      onClick={() => onProviderModelSelectStable(agent, props.model ?? stored.model)}
    >
      Pick the model
    </button>
  );
}

it("keeps a Cursor thread's stored model and options when the user re-picks its unavailable row", async () => {
  setup();
  const thread = agentThread("thread-agent");
  await using _screen = await render(<Picker thread={thread} runtime={null} />);
  await page.getByRole("button", { name: "Pick the model" }).click();

  await vi.waitFor(() => {
    const draft = useComposerDraftStore
      .getState()
      .getComposerDraft(scopeThreadRef(environmentId, thread.id));
    expect(draft?.modelSelectionByProvider[agent] ?? thread.modelSelection).toEqual(stored);
  });
});

it("switches back to the thread's stored model while the session runs on another instance", async () => {
  setup();
  const thread = agentThread("thread-agent-handoff");
  const runtime = { providerInstanceId: ProviderInstanceId.make("codex") } as Parameters<
    typeof useComposerSelection
  >[0]["activeRuntime"];
  await using _screen = await render(<Picker thread={thread} runtime={runtime} />);
  await page.getByRole("button", { name: "Pick the model" }).click();

  await vi.waitFor(() => {
    const draft = useComposerDraftStore
      .getState()
      .getComposerDraft(scopeThreadRef(environmentId, thread.id));
    expect(draft?.activeProvider).toBe(agent);
    expect(
      deriveEffectiveComposerModelState({
        draft,
        threadStarted: true,
        providers,
        selectedProvider: ProviderDriverKind.make("acpRegistry"),
        selectedInstanceId: agent,
        threadModelSelection: thread.modelSelection,
        projectModelSelection: null,
        settings: DEFAULT_UNIFIED_SETTINGS,
      }),
    ).toEqual({ selectedModel: stored.model, modelOptions: { [agent]: stored.options } });
  });
});

it("saves a re-picked model again when its first save failed", async () => {
  const { setModelSelection } = setup();
  setModelSelection
    .mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("offline"))))
    .mockResolvedValue(AsyncResult.success(undefined));
  const thread = agentThread("thread-agent-retry");
  appAtomRegistry.set(shellAtom(thread.id), thread);
  await using _screen = await render(
    <AppAtomRegistryProvider>
      <Picker thread={thread} runtime={null} model="auto-smart" />
    </AppAtomRegistryProvider>,
  );
  const pick = page.getByRole("button", { name: "Pick the model" });
  await pick.click();
  await vi.waitFor(() => expect(setModelSelection).toHaveBeenCalledTimes(1));
  await pick.click();

  const autoSave = expect.objectContaining({
    input: {
      threadId: thread.id,
      modelSelection: expect.objectContaining({ instanceId: agent, model: "auto-smart" }),
    },
  });
  await vi.waitFor(() => expect(setModelSelection.mock.calls).toEqual([[autoSave], [autoSave]]));
});

it("saves a pick of a seeded model the started thread does not show", async () => {
  const { setModelSelection } = setup();
  setModelSelection.mockResolvedValue(AsyncResult.success(undefined));
  const thread = agentThread("thread-agent-seeded");
  appAtomRegistry.set(shellAtom(thread.id), thread);
  useComposerDraftStore
    .getState()
    .setModelSelection(
      scopeThreadRef(environmentId, thread.id),
      createModelSelection(agent, "auto-smart"),
    );
  await using _screen = await render(
    <AppAtomRegistryProvider>
      <Picker thread={thread} runtime={null} model="auto-smart" />
    </AppAtomRegistryProvider>,
  );
  await page.getByRole("button", { name: "Pick the model" }).click();

  await vi.waitFor(() =>
    expect(setModelSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          threadId: thread.id,
          modelSelection: expect.objectContaining({ instanceId: agent, model: "auto-smart" }),
        },
      }),
    ),
  );
});

it("keeps a queued edit's model pick in its own draft", async () => {
  const { setModelSelection } = setup();
  const thread = agentThread("thread-queued-edit");
  const threadRef = scopeThreadRef(environmentId, thread.id);
  const draftTarget = queuedRunEditDraftId(threadRef, RunId.make("queued-run"));
  await using _screen = await render(
    <Picker thread={thread} runtime={null} model="auto-smart" draftTarget={draftTarget} />,
  );
  await page.getByRole("button", { name: "Pick the model" }).click();
  const store = useComposerDraftStore.getState();
  expect(store.getComposerDraft(draftTarget)?.modelSelectionByProvider[agent]?.model).toBe(
    "auto-smart",
  );
  expect(store.getComposerDraft(threadRef)).toBeNull();
  expect(setModelSelection).not.toHaveBeenCalled();
});
