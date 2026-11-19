import {
  ProviderDriverKind,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2ExecutionNode,
  type OrchestrationV2HistoricalMessage,
  type OrchestrationV2ProviderCapabilities,
  type OrchestrationV2ProviderSession,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2TurnItem,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import {
  makeProviderFailure,
  makeProviderFailureTurnItem,
} from "@t3tools/provider-core/server/failure";
import { turnScopedSelectionTransition } from "@t3tools/provider-core/server/selectionTransition";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import type {
  ProviderAdapterDriver,
  ProviderAdapterDriverCreateInput,
} from "@t3tools/provider-core/server/adapterDriver";
import { ProviderAdapterDriverCreateError } from "@t3tools/provider-core/server/adapterDriver";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import { collectStreamAsString } from "@t3tools/provider-core/server/snapshotProbe";

import { FrontalSettings } from "../settings.ts";
import { makeFrontalEnvironment } from "./environment.ts";
import { parseFrontalJsonOutput, renderFrontalPrompt } from "./protocol.ts";
import { buildFrontalLaunchArgs } from "./launch.ts";

export const FRONTAL_PROVIDER = ProviderDriverKind.make("frontal");
const MAX_HISTORY_CHARS = 48_000;

function boundHistory(
  entries: ReadonlyArray<{ readonly role: "user" | "assistant"; readonly text: string }>,
): Array<{ readonly role: "user" | "assistant"; readonly text: string }> {
  const bounded: Array<{ readonly role: "user" | "assistant"; readonly text: string }> = [];
  let remaining = MAX_HISTORY_CHARS;
  for (let index = entries.length - 1; index >= 0 && remaining > 0; index--) {
    const entry = entries[index]!;
    const text = entry.text.slice(-remaining);
    bounded.unshift({ role: entry.role, text });
    remaining -= text.length;
  }
  return bounded;
}

export const FrontalProviderCapabilitiesV2 = {
  runtimePolicy: { enforcement: "native" },
  sessions: {
    supportsMultipleProviderThreadsPerSession: false,
    supportsModelSwitchInSession: true,
    supportsProviderSwitchingViaHandoff: true,
    supportsRuntimeModeSwitchInSession: false,
    pendingRequestsSurviveRestart: false,
  },
  threads: {
    canCreateEmptyThread: true,
    canReadThreadSnapshot: true,
    canRollbackThread: false,
    canForkThread: false,
    canForkFromTurn: false,
    canForkFromSubagentThread: false,
    exposesNativeThreadId: false,
  },
  turns: {
    exposesNativeTurnId: false,
    emitsTurnStarted: true,
    emitsTurnCompleted: true,
    supportsInterrupt: true,
    supportsActiveSteering: false,
    supportsSteeringByInterruptRestart: false,
    supportsQueuedMessages: false,
    terminalStatusQuality: "strong",
  },
  streaming: {
    streamsAssistantText: false,
    streamsReasoning: false,
    streamsToolOutput: false,
    streamsPlanText: false,
    emitsMessageCompleted: true,
  },
  tools: {
    exposesToolItemIds: false,
    emitsToolStarted: false,
    emitsToolCompleted: false,
    emitsToolOutput: false,
    supportsMcpTools: false,
    supportsDynamicToolCallbacks: false,
  },
  approvals: {
    supportsCommandApproval: false,
    supportsFileReadApproval: false,
    supportsFileChangeApproval: false,
    supportsApplyPatchApproval: false,
    approvalsHaveNativeRequestIds: false,
    approvalCallbacksAreLiveOnly: false,
    approvalsCanOriginateFromSubagents: false,
  },
  planning: {
    emitsPlanUpdated: false,
    emitsTodoList: false,
    emitsProposedPlan: false,
    supportsStructuredQuestions: false,
    planDeltasHaveItemIds: false,
  },
  subagents: {
    supportsSubagents: false,
    exposesSubagentThreadIds: false,
    emitsSubagentLifecycle: false,
    canWaitForSubagents: false,
    canCloseSubagents: false,
    canForkSubagentThread: false,
  },
  context: {
    acceptsSystemContext: false,
    acceptsDeveloperContext: false,
    acceptsSyntheticUserContext: true,
    canGenerateSummaries: false,
    canConsumeHandoffSummaries: true,
    supportsDeltaHandoff: true,
    supportsFullThreadHandoff: true,
    maxRecommendedHandoffChars: MAX_HISTORY_CHARS,
  },
  checkpointing: {
    appCanCheckpointFilesystem: true,
    supportsNestedCheckpointScopes: false,
    providerCanRollbackConversation: false,
    providerRollbackReturnsSnapshot: false,
    providerCanReadConversationSnapshot: true,
  },
  identity: {
    nativeThreadIds: "weak",
    nativeTurnIds: "weak",
    nativeItemIds: "weak",
    nativeRequestIds: "weak",
  },
} satisfies OrchestrationV2ProviderCapabilities;

interface ActiveTurn {
  readonly input: ProviderAdapter.ProviderAdapterV2TurnInput;
  readonly providerTurn: OrchestrationV2ProviderTurn;
  readonly startedAt: DateTime.Utc;
  interrupted: boolean;
}

const nativeRef = (nativeId: string) => ({
  driver: FRONTAL_PROVIDER,
  nativeId,
  strength: "weak" as const,
});

export interface FrontalAdapterOptions {
  readonly instanceId: ProviderInstanceId;
  readonly settings: FrontalSettings;
  readonly environment: NodeJS.ProcessEnv;
}

export const makeFrontalAdapterV2 = Effect.fn("makeFrontalAdapterV2")(function* (
  options: FrontalAdapterOptions,
) {
  const idAllocator = yield* IdAllocator.IdAllocatorV2;
  const host = yield* ProviderHost.ProviderHost;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const protocolError = (detail: string, payload?: unknown) =>
    new ProviderAdapter.ProviderAdapterProtocolError({
      driver: FRONTAL_PROVIDER,
      detail,
      ...(payload === undefined ? {} : { payload }),
    });

  return ProviderAdapter.ProviderAdapterV2.of({
    instanceId: options.instanceId,
    driver: FRONTAL_PROVIDER,
    getCapabilities: Effect.fn("FrontalAdapter.getCapabilities")(() =>
      Effect.succeed(FrontalProviderCapabilitiesV2),
    ),
    planSelectionTransition: Effect.fn("FrontalAdapter.planSelectionTransition")(() =>
      Effect.succeed(turnScopedSelectionTransition()),
    ),
    openSession: Effect.fn("FrontalAdapter.openSession")(function* (
      input: ProviderAdapter.ProviderAdapterV2OpenSessionInput,
    ) {
      const scope = yield* Effect.scope;
      const cwd = input.runtimePolicy.cwd ?? host.paths.cwd;
      const now = yield* DateTime.now;
      let session: OrchestrationV2ProviderSession = {
        id: input.providerSessionId,
        driver: FRONTAL_PROVIDER,
        providerInstanceId: options.instanceId,
        status: "ready",
        cwd,
        model: input.modelSelection.model,
        capabilities: FrontalProviderCapabilitiesV2,
        extensionStatuses: [],
        createdAt: now,
        updatedAt: now,
        lastError: null,
      };
      const events = yield* Queue.unbounded<
        ProviderAdapter.ProviderAdapterV2Event,
        ProviderAdapter.ProviderAdapterV2Error | Cause.Done
      >();
      let thread: OrchestrationV2ProviderThread | undefined;
      let active: ActiveTurn | undefined;
      let activeProcess: ChildProcessSpawner.ChildProcessHandle | undefined;
      let closed = false;
      let history: Array<{ readonly role: "user" | "assistant"; readonly text: string }> = [];
      const providerTurns: Array<OrchestrationV2ProviderTurn> = [];
      const messages: Array<OrchestrationV2ConversationMessage> = [];

      const emit = (event: ProviderAdapter.ProviderAdapterV2Event) =>
        Queue.offer(events, event).pipe(Effect.asVoid);
      const updateSession = Effect.fnUntraced(function* (
        status: OrchestrationV2ProviderSession["status"],
        lastError: string | null = null,
      ) {
        session = { ...session, status, lastError, updatedAt: yield* DateTime.now };
        yield* emit({
          type: "provider_session.updated",
          driver: FRONTAL_PROVIDER,
          providerSession: session,
        });
      });
      const updateThread = Effect.fnUntraced(function* (
        patch: Partial<OrchestrationV2ProviderThread>,
      ) {
        if (!thread) return;
        thread = { ...thread, ...patch, updatedAt: yield* DateTime.now };
        yield* emit({
          type: "provider_thread.updated",
          driver: FRONTAL_PROVIDER,
          providerThread: thread,
        });
      });

      const baseItem = (turn: ActiveTurn, nativeItemId: string, time: DateTime.Utc) => ({
        id: idAllocator.derive.turnItemFromProviderItem({ driver: FRONTAL_PROVIDER, nativeItemId }),
        threadId: turn.input.threadId,
        runId: turn.input.runId,
        nodeId: idAllocator.derive.nodeFromProviderItem({ driver: FRONTAL_PROVIDER, nativeItemId }),
        providerThreadId: turn.input.providerThread.id,
        providerTurnId: turn.providerTurn.id,
        nativeItemRef: nativeRef(nativeItemId),
        parentItemId: null,
        ordinal: turn.input.providerTurnOrdinal * 100 + 1,
        status: "completed" as const,
        title: null,
        startedAt: turn.startedAt,
        completedAt: time,
        updatedAt: time,
      });

      const finish = Effect.fnUntraced(function* (
        turn: ActiveTurn,
        status: "completed" | "interrupted" | "failed",
        detail?: string,
        assistantText?: string,
      ) {
        if (active !== turn) return;
        active = undefined;
        activeProcess = undefined;
        const completedAt = yield* DateTime.now;
        const providerTurn = { ...turn.providerTurn, status, completedAt };
        const index = providerTurns.findIndex((entry) => entry.id === providerTurn.id);
        if (index >= 0) providerTurns[index] = providerTurn;
        yield* emit({
          type: "provider_turn.updated",
          driver: FRONTAL_PROVIDER,
          threadId: turn.input.threadId,
          providerTurn,
        });
        if (status === "completed" && assistantText !== undefined) {
          const nativeItemId = `${turn.providerTurn.id}:assistant`;
          const messageId = idAllocator.derive.messageFromProviderItem({
            driver: FRONTAL_PROVIDER,
            nativeItemId,
          });
          const message: OrchestrationV2ConversationMessage = {
            id: messageId,
            threadId: turn.input.threadId,
            runId: turn.input.runId,
            nodeId: idAllocator.derive.nodeFromProviderItem({
              driver: FRONTAL_PROVIDER,
              nativeItemId,
            }),
            role: "assistant",
            text: assistantText,
            attachments: [],
            streaming: false,
            createdBy: "agent",
            creationSource: "provider",
            createdAt: turn.startedAt,
            updatedAt: completedAt,
          };
          messages.push(message);
          history = boundHistory([...history, { role: "assistant" as const, text: assistantText }]);
          yield* emit({ type: "message.updated", driver: FRONTAL_PROVIDER, message });
          const item = {
            ...baseItem(turn, nativeItemId, completedAt),
            type: "assistant_message" as const,
            messageId,
            text: assistantText,
            streaming: false,
            status: "completed" as const,
            title: null,
            completedAt,
          } satisfies Extract<OrchestrationV2TurnItem, { readonly type: "assistant_message" }>;
          yield* emit({ type: "turn_item.updated", driver: FRONTAL_PROVIDER, turnItem: item });
          const node: OrchestrationV2ExecutionNode = {
            id: item.nodeId!,
            threadId: turn.input.threadId,
            runId: turn.input.runId,
            parentNodeId: turn.input.rootNodeId,
            rootNodeId: turn.input.rootNodeId,
            kind: "assistant_message",
            status: "completed",
            countsForRun: false,
            providerThreadId: turn.input.providerThread.id,
            providerTurnId: turn.providerTurn.id,
            nativeItemRef: nativeRef(nativeItemId),
            runtimeRequestId: null,
            checkpointScopeId: null,
            startedAt: turn.startedAt,
            completedAt,
          };
          yield* emit({ type: "node.updated", driver: FRONTAL_PROVIDER, node });
          yield* updateThread({
            status: "idle",
            nativeConversationHeadRef: nativeRef(turn.providerTurn.id),
          });
          yield* updateSession("ready");
          yield* emit({
            type: "turn.terminal",
            driver: FRONTAL_PROVIDER,
            providerThreadId: turn.input.providerThread.id,
            providerTurnId: turn.providerTurn.id,
            runOrdinal: turn.input.runOrdinal,
            status: "completed",
            failure: null,
            threadDisposition: "reusable",
          });
          return;
        }

        const failure =
          status === "failed"
            ? makeProviderFailure({
                class: "provider_error",
                message: detail ?? "Frontal Code turn failed.",
              })
            : null;
        let failureItemOrdinal: number | undefined;
        if (failure) {
          const item = makeProviderFailureTurnItem({
            driver: FRONTAL_PROVIDER,
            threadId: turn.input.threadId,
            runId: turn.input.runId,
            nodeId: turn.input.rootNodeId,
            providerThreadId: turn.input.providerThread.id,
            providerTurnId: turn.providerTurn.id,
            itemOrdinal: turn.input.providerTurnOrdinal * 100 + 1,
            failure,
            occurredAt: completedAt,
          });
          failureItemOrdinal = item.ordinal;
          yield* emit({ type: "turn_item.updated", driver: FRONTAL_PROVIDER, turnItem: item });
        }
        yield* updateThread({ status: "idle" });
        yield* updateSession(status === "failed" ? "error" : "ready", detail ?? null);
        if (failure === null) {
          yield* emit({
            type: "turn.terminal",
            driver: FRONTAL_PROVIDER,
            providerThreadId: turn.input.providerThread.id,
            providerTurnId: turn.providerTurn.id,
            runOrdinal: turn.input.runOrdinal,
            status: status === "interrupted" ? "interrupted" : "completed",
            failure: null,
            threadDisposition: "reusable",
          });
        } else {
          yield* emit({
            type: "turn.terminal",
            driver: FRONTAL_PROVIDER,
            providerThreadId: turn.input.providerThread.id,
            providerTurnId: turn.providerTurn.id,
            runOrdinal: turn.input.runOrdinal,
            failureItemOrdinal: failureItemOrdinal!,
            status: "failed",
            failure,
            threadDisposition: "reusable",
          });
        }
      });

      const runTurn = Effect.fnUntraced(function* (turn: ActiveTurn, prompt: string) {
        const argsResult = yield* Effect.sync(() => {
          try {
            return {
              ok: true as const,
              value: buildFrontalLaunchArgs(options.settings, {
                runtimeMode: turn.input.runtimePolicy.runtimeMode,
                model: turn.input.modelSelection.model,
                prompt,
              }),
            };
          } catch {
            return { ok: false as const };
          }
        });
        if (!argsResult.ok) {
          yield* finish(turn, "failed", "Frontal launch arguments are invalid.");
          return;
        }
        const spawnCommand = yield* resolveSpawnCommand(
          options.settings.binaryPath,
          argsResult.value,
          {
            env: options.environment,
          },
        ).pipe(Effect.result);
        if (Result.isFailure(spawnCommand)) {
          yield* finish(turn, "failed", "Frontal Code process could not be resolved.");
          return;
        }
        const childResult = yield* spawner
          .spawn(
            ChildProcess.make(spawnCommand.success.command, spawnCommand.success.args, {
              cwd,
              env: options.environment,
              extendEnv: false,
              shell: spawnCommand.success.shell,
              stdin: { stream: "pipe", endOnDone: true },
              forceKillAfter: "1 second",
            }),
          )
          .pipe(Effect.result);
        if (Result.isFailure(childResult)) {
          yield* finish(turn, "failed", "Frontal Code process could not be started.");
          return;
        }
        const child = childResult.success;
        activeProcess = child;
        if (turn.interrupted) {
          yield* child
            .kill({ killSignal: "SIGINT", forceKillAfter: "1 second" })
            .pipe(Effect.ignore);
        }
        yield* Stream.fromIterable<Uint8Array>([]).pipe(
          Stream.run(child.stdin),
          Effect.forkIn(scope),
        );
        const result = yield* Effect.all(
          [
            collectStreamAsString(child.stdout),
            collectStreamAsString(child.stderr),
            child.exitCode,
          ],
          { concurrency: "unbounded" },
        ).pipe(Effect.result);
        if (turn.interrupted) {
          yield* finish(turn, "interrupted");
          return;
        }
        if (Result.isFailure(result)) {
          yield* finish(turn, "failed", "Frontal Code process output could not be read.");
          return;
        }
        const [stdout, stderr, exitCode] = result.success;
        if (Number(exitCode) !== 0) {
          const detail = stderr.trim()
            ? `Frontal Code exited with status ${Number(exitCode)}: ${stderr.trim()}`
            : `Frontal Code exited with status ${Number(exitCode)}.`;
          yield* finish(turn, "failed", detail);
          return;
        }
        const summary = yield* Effect.sync(() => {
          try {
            return { ok: true as const, value: parseFrontalJsonOutput(stdout) };
          } catch {
            return { ok: false as const };
          }
        });
        if (!summary.ok) {
          yield* finish(turn, "failed", "Frontal Code returned an invalid JSON turn summary.");
          return;
        }
        yield* finish(turn, "completed", undefined, summary.value.message);
      });

      const runtime: ProviderAdapter.ProviderAdapterV2SessionRuntime = {
        instanceId: options.instanceId,
        driver: FRONTAL_PROVIDER,
        providerSessionId: input.providerSessionId,
        providerSession: session,
        canResumeAfterRestart: false,
        backgroundTasksEndWithProcess: true,
        hasPendingBackgroundWork: Effect.sync(() => active !== undefined),
        events: Stream.fromQueue(events),
        ensureThread: Effect.fn("FrontalAdapter.ensureThread")(function* (threadInput) {
          if (thread && !threadInput.forceNewNativeThread) return thread;
          if (thread && active)
            return yield* protocolError("Cannot replace an active Frontal turn.");
          const createdAt = yield* DateTime.now;
          const nativeThreadId = `${options.instanceId}:${threadInput.threadId}:${threadInput.modelSelection.model}${threadInput.forceNewNativeThread ? `:${DateTime.formatIso(createdAt)}` : ""}`;
          thread = {
            id: idAllocator.derive.providerThread({
              driver: FRONTAL_PROVIDER,
              nativeThreadId,
              providerInstanceId: options.instanceId,
            }),
            driver: FRONTAL_PROVIDER,
            providerInstanceId: options.instanceId,
            providerSessionId: threadInput.providerSessionId ?? input.providerSessionId,
            appThreadId: threadInput.threadId,
            ownerNodeId: null,
            nativeThreadRef: nativeRef(nativeThreadId),
            nativeConversationHeadRef: null,
            status: "idle",
            firstRunOrdinal: null,
            lastRunOrdinal: null,
            handoffIds: [],
            forkedFrom: null,
            pendingBackgroundTasks: [],
            contextUsage: null,
            nativeMetadata: { modelSelection: threadInput.modelSelection },
            goal: null,
            createdAt,
            updatedAt: createdAt,
          };
          yield* emit({
            type: "provider_thread.updated",
            driver: FRONTAL_PROVIDER,
            providerThread: thread,
          });
          return thread;
        }),
        resumeThread: Effect.fn("FrontalAdapter.resumeThread")(function* (resumeInput) {
          if (!thread || thread.id !== resumeInput.providerThread.id) {
            return yield* new ProviderAdapter.ProviderAdapterResumeThreadError({
              driver: FRONTAL_PROVIDER,
              providerSessionId: input.providerSessionId,
              providerThreadId: resumeInput.providerThread.id,
            });
          }
          return thread;
        }),
        injectHistory: Effect.fn("FrontalAdapter.injectHistory")(function* (
          historyInput: ProviderAdapter.ProviderAdapterV2HistoricalContext & {
            readonly providerThread: OrchestrationV2ProviderThread;
          },
        ) {
          yield* Effect.sync(() => {
            history = historyInput.messages
              .filter(
                (message: OrchestrationV2HistoricalMessage) =>
                  message.role === "user" || message.role === "assistant",
              )
              .map((message): { readonly role: "user" | "assistant"; readonly text: string } => ({
                role: message.role,
                text: message.text,
              }));
            history = boundHistory(history);
          });
          return true;
        }),
        startTurn: Effect.fn("FrontalAdapter.startTurn")(function* (turnInput) {
          if (closed) return yield* protocolError("Frontal session is closed.");
          if (active) {
            return yield* new ProviderAdapter.ProviderAdapterTurnStartError({
              driver: FRONTAL_PROVIDER,
              threadId: turnInput.threadId,
              providerThreadId: turnInput.providerThread.id,
              runId: turnInput.runId,
              cause: "previous turn active",
            });
          }
          if (turnInput.message.attachments.length > 0) {
            return yield* protocolError(
              "Frontal Code's one-shot JSON interface does not accept T3 attachments.",
            );
          }
          const startedAt = yield* DateTime.now;
          const nativeTurnId = `${turnInput.providerThread.id}:${turnInput.runId}:${turnInput.attemptId}`;
          const providerTurn: OrchestrationV2ProviderTurn = {
            id: idAllocator.derive.providerTurn({ driver: FRONTAL_PROVIDER, nativeTurnId }),
            providerThreadId: turnInput.providerThread.id,
            nodeId: turnInput.rootNodeId,
            runAttemptId: turnInput.attemptId,
            nativeTurnRef: nativeRef(nativeTurnId),
            ordinal: turnInput.providerTurnOrdinal,
            status: "running",
            startedAt,
            completedAt: null,
          };
          const turn: ActiveTurn = {
            input: turnInput,
            providerTurn,
            startedAt,
            interrupted: false,
          };
          active = turn;
          providerTurns.push(providerTurn);
          yield* updateThread({
            status: "active",
            firstRunOrdinal: threadInputOr(
              turnInput.providerThread.firstRunOrdinal,
              turnInput.runOrdinal,
            ),
            lastRunOrdinal: turnInput.runOrdinal,
          });
          yield* updateSession("running");
          yield* emit({
            type: "provider_turn.updated",
            driver: FRONTAL_PROVIDER,
            threadId: turnInput.threadId,
            providerTurn,
          });
          const prompt = renderFrontalPrompt(history, turnInput.appContext, turnInput.message.text);
          history = boundHistory([
            ...history,
            { role: "user" as const, text: turnInput.message.text },
          ]);
          yield* runTurn(turn, prompt).pipe(
            Effect.provideService(Scope.Scope, scope),
            Effect.forkIn(scope),
            Effect.asVoid,
          );
        }),
        steerTurn: (steerInput) =>
          Effect.fail(
            new ProviderAdapter.ProviderAdapterSteerRunUnsupportedError({
              driver: FRONTAL_PROVIDER,
              providerThreadId: steerInput.providerThread.id,
            }),
          ),
        interruptTurn: Effect.fn("FrontalAdapter.interruptTurn")(function* (interruptInput) {
          if (!active || active.providerTurn.id !== interruptInput.providerTurnId) return;
          active.interrupted = true;
          if (activeProcess)
            yield* activeProcess
              .kill({ killSignal: "SIGINT", forceKillAfter: "1 second" })
              .pipe(Effect.ignore);
        }),
        respondToRuntimeRequest: (requestInput) =>
          Effect.fail(
            new ProviderAdapter.ProviderAdapterRuntimeRequestResponseError({
              driver: FRONTAL_PROVIDER,
              requestId: requestInput.requestId,
              cause: "Frontal Code approval prompts are not exposed by its JSON interface.",
            }),
          ),
        readThreadSnapshot: Effect.fn("FrontalAdapter.readThreadSnapshot")(
          function* (snapshotInput) {
            if (!thread || thread.id !== snapshotInput.providerThread.id) {
              return yield* new ProviderAdapter.ProviderAdapterReadThreadSnapshotError({
                driver: FRONTAL_PROVIDER,
                providerThreadId: snapshotInput.providerThread.id,
              });
            }
            return {
              providerThread: thread,
              providerTurns: [...providerTurns],
              messages: [...messages],
              runtimeRequests: [],
              providerPayload: { history },
            };
          },
        ),
        rollbackThread: (rollbackInput) =>
          Effect.fail(
            new ProviderAdapter.ProviderAdapterRollbackThreadError({
              driver: FRONTAL_PROVIDER,
              providerThreadId: rollbackInput.providerThread.id,
              checkpointId: rollbackInput.target.checkpointId,
            }),
          ),
        forkThread: (forkInput) =>
          Effect.fail(
            new ProviderAdapter.ProviderAdapterForkThreadError({
              driver: FRONTAL_PROVIDER,
              providerThreadId: forkInput.sourceProviderThread.id,
            }),
          ),
      };
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          closed = true;
          if (activeProcess) {
            yield* activeProcess
              .kill({ killSignal: "SIGTERM", forceKillAfter: "1 second" })
              .pipe(Effect.ignore);
          }
          yield* Queue.shutdown(events);
        }),
      );
      return runtime;
    }),
  });
});

function threadInputOr(value: number | null, fallback: number): number {
  return value ?? fallback;
}

export type FrontalAdapterV2DriverEnv =
  | IdAllocator.IdAllocatorV2
  | ProviderHost.ProviderHost
  | ChildProcessSpawner.ChildProcessSpawner;

const DEFAULT_FRONTAL_SETTINGS = Schema.decodeSync(FrontalSettings)({});

export const FrontalAdapterV2Driver: ProviderAdapterDriver<
  FrontalSettings,
  FrontalAdapterV2DriverEnv
> = {
  driverKind: FRONTAL_PROVIDER,
  configSchema: FrontalSettings,
  defaultConfig: () => DEFAULT_FRONTAL_SETTINGS,
  create: Effect.fn("FrontalAdapterV2Driver.create")(
    function* (input: ProviderAdapterDriverCreateInput<FrontalSettings>) {
      const environment = yield* Effect.sync(() =>
        makeFrontalEnvironment(process.env, input.environment),
      );
      if (input.config.homePath) environment.FRONTAL_CODE_HOME = input.config.homePath;
      if (input.config.configPath) environment.FRONTAL_CODE_CONFIG_HOME = input.config.configPath;
      return yield* makeFrontalAdapterV2({
        instanceId: input.instanceId,
        settings: { ...input.config, enabled: input.enabled },
        environment,
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterDriverCreateError({
              driver: FRONTAL_PROVIDER,
              instanceId: input.instanceId,
              detail: "Failed to create Frontal Code adapter.",
              cause,
            }),
        ),
      ),
  ),
};
