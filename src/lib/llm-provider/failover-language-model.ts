import "server-only";

import type { LanguageModel } from "ai";
import type { AgentChatModelDefinition } from "@/features/agent-chat/shared/model-registry-types";
import {
  classifyProviderFailure,
  type ProviderRuntimeFailure,
} from "./provider-failure";
import {
  toolAppearsStateChanging,
  toolResultAppearsError,
} from "@/features/agent-chat/server/tools/tool-context-policy";

export type FailoverModelCandidate = {
  definition: AgentChatModelDefinition;
  model: LanguageModel;
};

export type FailoverAttemptReason =
  | "INITIAL"
  | "TOOL_LOOP"
  | "ESCALATION"
  | "FAILOVER";

type StartedAttempt = { attemptId: string };

type FailoverCallbacks = {
  stepIndex: number;
  candidates: readonly FailoverModelCandidate[];
  initialReason?: FailoverAttemptReason;
  /** Attempt ordinals already consumed before the SDK invocation (for example runtime resolution). */
  initialStepAttemptIndex?: number;
  onAttemptStarted(args: {
    stepIndex: number;
    stepAttemptIndex: number;
    model: AgentChatModelDefinition;
    reason: FailoverAttemptReason;
  }): Promise<StartedAttempt>;
  onAttemptFailed(args: {
    attemptId: string;
    model: AgentChatModelDefinition;
    failure: ProviderRuntimeFailure;
  }): Promise<void>;
  onCandidateCommitted(args: {
    attemptId: string;
    model: AgentChatModelDefinition;
  }): void;
};

const COMMIT_PART_TYPES = new Set([
  "text-start",
  "text-delta",
  "text-end",
  "reasoning-start",
  "reasoning-delta",
  "reasoning-end",
  "tool-input-start",
  "tool-input-delta",
  "tool-input-end",
  "tool-call",
  "tool-result",
  "tool-approval-request",
  "file",
  "source",
  "raw",
  "finish",
]);

function providerId(model: AgentChatModelDefinition): string {
  return model.credentialProvider ?? model.provider;
}

function classifyCandidateError(
  error: unknown,
  definition: AgentChatModelDefinition,
): ProviderRuntimeFailure {
  return classifyProviderFailure({
    error,
    provider: providerId(definition),
    source: "inference",
    model: definition,
  });
}

function isErrorPart(value: unknown): value is { type: "error"; error?: unknown } {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && (value as { type?: unknown }).type === "error";
}

function isCommitPart(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string") return false;
  if (COMMIT_PART_TYPES.has(type)) return true;
  // Provider/custom content is observable and therefore commits the stream.
  return type.startsWith("data-") || type === "custom";
}

function compositeSupportedUrls(candidates: readonly FailoverModelCandidate[]): unknown {
  if (candidates.length !== 1) return {};
  return (candidates[0]!.model as unknown as { supportedUrls?: unknown }).supportedUrls ?? {};
}

function isContextOverflowFailure(failure: ProviderRuntimeFailure): boolean {
  if (failure.statusCode === 413) return true;
  const text = [failure.providerCode, failure.providerMessage]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
  return /(?:context[_ -]?length[_ -]?exceeded|maximum context length|context window|input[_ -]?too[_ -]?long|prompt[_ -]?too[_ -]?long|request[_ -]?too[_ -]?large|too many (?:input )?tokens|input tokens?.*(?:exceed|limit)|exceed(?:s|ed)?.*context)/.test(text);
}

type LowLevelPromptMessage = {
  role?: unknown;
  content?: unknown;
  [key: string]: unknown;
};

function containsCriticalContextEvidence(value: unknown, depth = 0): boolean {
  if (depth > 8 || value == null) return false;
  if (Array.isArray(value)) {
    return value.some((entry) => containsCriticalContextEvidence(entry, depth + 1));
  }
  if (typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.stateChanging === true) return true;
  if (
    typeof record.toolName === "string"
    && toolAppearsStateChanging({ toolName: record.toolName })
  ) return true;
  if (record.status === "externalized_error") return true;
  if (toolResultAppearsError(record)) return true;
  return Object.values(record).some((entry) =>
    containsCriticalContextEvidence(entry, depth + 1),
  );
}

function reducePromptForContextRetry(options: unknown): unknown | null {
  if (typeof options !== "object" || options === null || Array.isArray(options)) return null;
  const prompt = (options as { prompt?: unknown }).prompt;
  if (!Array.isArray(prompt) || prompt.length === 0) return null;

  const systemMessages: unknown[] = [];
  const groups: unknown[][] = [];
  let active: unknown[] | null = null;
  for (const raw of prompt) {
    const message = raw as LowLevelPromptMessage;
    const role = typeof message?.role === "string" ? message.role : "";
    if (role === "system") {
      systemMessages.push(raw);
      continue;
    }
    if (role === "user" || active === null) {
      active = [];
      groups.push(active);
    }
    active.push(raw);
  }

  if (groups.length <= 1) return null;
  // Context rejection after the model-aware compiler usually means provider
  // tokenization was less forgiving than our estimate. Reduce a contiguous
  // oldest half of the already-projected turn groups rather than collapsing all
  // the way to the newest turn immediately. Preserve any older groups that
  // still carry mutation/failure evidence; ordinary history is expendable
  // before those facts. Canonical history remains in storage for rehydration.
  const retainedGroupCount = Math.max(1, Math.ceil(groups.length / 2));
  const newestRetainedStart = groups.length - retainedGroupCount;
  const retainedGroups = groups.filter((group, index) =>
    index >= newestRetainedStart || containsCriticalContextEvidence(group),
  );
  const reducedPrompt = [
    ...systemMessages,
    ...retainedGroups.flat(),
  ];
  if (reducedPrompt.length >= prompt.length) return null;
  return { ...(options as Record<string, unknown>), prompt: reducedPrompt };
}

export function createByokFailoverLanguageModel(
  params: FailoverCallbacks,
): LanguageModel {
  if (params.candidates.length === 0) {
    throw new Error("A failover language model requires at least one candidate");
  }

  const primary = params.candidates[0]!.model;
  if (typeof primary !== "object" || primary === null) {
    throw new TypeError(
      "BYOK failover requires resolved language-model instances, not registry model IDs",
    );
  }

  let nextStepAttemptIndex = Math.max(
    0,
    Math.trunc(params.initialStepAttemptIndex ?? 0),
  );
  const invalidatedProviders = new Set<string>();
  const candidateEligible = (candidateIndex: number): boolean => {
    const candidate = params.candidates[candidateIndex];
    return Boolean(candidate && !invalidatedProviders.has(providerId(candidate.definition)));
  };
  const recordCredentialDisposition = (
    candidate: FailoverModelCandidate,
    failure: ProviderRuntimeFailure,
  ) => {
    if (failure.credentialDisposition === "invalidate") {
      invalidatedProviders.add(providerId(candidate.definition));
    }
  };
  const beginAttempt = async (candidateIndex: number) => {
    const candidate = params.candidates[candidateIndex]!;
    const stepAttemptIndex = nextStepAttemptIndex;
    nextStepAttemptIndex += 1;
    const started = await params.onAttemptStarted({
      stepIndex: params.stepIndex,
      stepAttemptIndex,
      model: candidate.definition,
      reason: candidateIndex === 0
        ? (params.initialReason ?? (params.stepIndex === 0 ? "INITIAL" : "TOOL_LOOP"))
        : "FAILOVER",
    });
    return { candidate, started };
  };

  const doGenerate = async (options: unknown): Promise<unknown> => {
    let lastFailure: ProviderRuntimeFailure | null = null;
    for (let index = 0; index < params.candidates.length; index += 1) {
      if (!candidateEligible(index)) continue;
      let attempt = await beginAttempt(index);
      let attemptOptions = options;
      let contextRetryUsed = false;
      while (true) {
        let result: unknown;
        try {
          result = await (attempt.candidate.model as unknown as {
            doGenerate(input: unknown): Promise<unknown>;
          }).doGenerate(attemptOptions);
        } catch (error) {
          const failure = classifyCandidateError(error, attempt.candidate.definition);
          lastFailure = failure;
          await params.onAttemptFailed({
            attemptId: attempt.started.attemptId,
            model: attempt.candidate.definition,
            failure,
          });
          recordCredentialDisposition(attempt.candidate, failure);

          if (!contextRetryUsed && isContextOverflowFailure(failure)) {
            const reduced = reducePromptForContextRetry(attemptOptions);
            if (reduced) {
              contextRetryUsed = true;
              attemptOptions = reduced;
              attempt = await beginAttempt(index);
              continue;
            }
          }
          if (!failure.failoverEligible && !isContextOverflowFailure(failure)) throw failure;
          break;
        }
        params.onCandidateCommitted({
          attemptId: attempt.started.attemptId,
          model: attempt.candidate.definition,
        });
        return result;
      }
    }
    throw lastFailure ?? new Error("No language-model candidate completed the request");
  };

  const doStream = async (options: unknown): Promise<unknown> => {
    type StreamResult = {
      stream: ReadableStream<unknown>;
      [key: string]: unknown;
    };
    type OpenedStream = {
      result: StreamResult;
      attempt: Awaited<ReturnType<typeof beginAttempt>>;
      options: unknown;
      contextRetryUsed: boolean;
    };

    const openCandidate = async (
      candidateIndex: number,
      baseOptions: unknown,
      allowContextRetry: boolean,
    ): Promise<{ opened: OpenedStream } | { failure: ProviderRuntimeFailure }> => {
      let attemptOptions = baseOptions;
      let contextRetryUsed = false;
      while (true) {
        const attempt = await beginAttempt(candidateIndex);
        try {
          const result = await (attempt.candidate.model as unknown as {
            doStream(input: unknown): Promise<StreamResult>;
          }).doStream(attemptOptions);
          return {
            opened: {
              result,
              attempt,
              options: attemptOptions,
              contextRetryUsed,
            },
          };
        } catch (error) {
          const failure = classifyCandidateError(error, attempt.candidate.definition);
          await params.onAttemptFailed({
            attemptId: attempt.started.attemptId,
            model: attempt.candidate.definition,
            failure,
          });
          recordCredentialDisposition(attempt.candidate, failure);
          if (allowContextRetry && !contextRetryUsed && isContextOverflowFailure(failure)) {
            const reduced = reducePromptForContextRetry(attemptOptions);
            if (reduced) {
              contextRetryUsed = true;
              attemptOptions = reduced;
              continue;
            }
          }
          return { failure };
        }
      }
    };

    let initialOpened: OpenedStream | null = null;
    let initialIndex = -1;
    let lastFailure: ProviderRuntimeFailure | null = null;

    for (let index = 0; index < params.candidates.length; index += 1) {
      if (!candidateEligible(index)) continue;
      const opened = await openCandidate(index, options, true);
      if ("opened" in opened) {
        initialOpened = opened.opened;
        initialIndex = index;
        break;
      }
      lastFailure = opened.failure;
      if (!opened.failure.failoverEligible && !isContextOverflowFailure(opened.failure)) {
        throw opened.failure;
      }
    }

    if (!initialOpened || initialIndex < 0) {
      throw lastFailure ?? new Error("No language-model candidate could start a stream");
    }

    const initialResult = initialOpened.result;
    const outer = new ReadableStream<unknown>({
      start(controller) {
        void (async () => {
          let index = initialIndex;
          let currentResult = initialOpened!.result;
          let currentAttempt = initialOpened!.attempt;
          let currentOptions = initialOpened!.options;
          let currentContextRetryUsed = initialOpened!.contextRetryUsed;

          while (index < params.candidates.length) {
            const reader = currentResult.stream.getReader();
            const buffered: unknown[] = [];
            let committed = false;
            let committedFailureRecorded = false;
            let retryFailure: ProviderRuntimeFailure | null = null;
            let settlementError: unknown | null = null;
            try {
              while (true) {
                const next = await reader.read();
                if (next.done) {
                  if (!committed) {
                    try {
                      params.onCandidateCommitted({
                        attemptId: currentAttempt.started.attemptId,
                        model: currentAttempt.candidate.definition,
                      });
                    } catch (error) {
                      settlementError = error;
                      break;
                    }
                    committed = true;
                    for (const part of buffered) controller.enqueue(part);
                  }
                  controller.close();
                  return;
                }
                const part = next.value;
                if (isErrorPart(part)) {
                  const failure = classifyCandidateError(
                    part.error ?? part,
                    currentAttempt.candidate.definition,
                  );
                  if (!committed) {
                    retryFailure = failure;
                    break;
                  }
                  if (!committedFailureRecorded) {
                    committedFailureRecorded = true;
                    try {
                      await params.onAttemptFailed({
                        attemptId: currentAttempt.started.attemptId,
                        model: currentAttempt.candidate.definition,
                        failure,
                      });
                    } catch (error) {
                      settlementError = error;
                      break;
                    }
                    recordCredentialDisposition(currentAttempt.candidate, failure);
                  }
                  controller.enqueue({ ...part, error: failure });
                  continue;
                }
                if (!committed && isCommitPart(part)) {
                  try {
                    params.onCandidateCommitted({
                      attemptId: currentAttempt.started.attemptId,
                      model: currentAttempt.candidate.definition,
                    });
                  } catch (error) {
                    settlementError = error;
                    break;
                  }
                  committed = true;
                  for (const bufferedPart of buffered) controller.enqueue(bufferedPart);
                  buffered.length = 0;
                  controller.enqueue(part);
                  continue;
                }
                if (committed) controller.enqueue(part);
                else buffered.push(part);
              }
            } catch (error) {
              const failure = classifyCandidateError(error, currentAttempt.candidate.definition);
              if (committed) {
                if (!committedFailureRecorded) {
                  committedFailureRecorded = true;
                  await params.onAttemptFailed({
                    attemptId: currentAttempt.started.attemptId,
                    model: currentAttempt.candidate.definition,
                    failure,
                  });
                  recordCredentialDisposition(currentAttempt.candidate, failure);
                }
                controller.error(failure);
                return;
              }
              retryFailure = failure;
            } finally {
              if (retryFailure && !committed) {
                await reader.cancel(retryFailure).catch(() => undefined);
              }
              reader.releaseLock();
            }

            if (settlementError !== null) {
              controller.error(settlementError);
              return;
            }
            if (!retryFailure) {
              controller.close();
              return;
            }

            await params.onAttemptFailed({
              attemptId: currentAttempt.started.attemptId,
              model: currentAttempt.candidate.definition,
              failure: retryFailure,
            });
            recordCredentialDisposition(currentAttempt.candidate, retryFailure);

            if (!currentContextRetryUsed && isContextOverflowFailure(retryFailure)) {
              const reduced = reducePromptForContextRetry(currentOptions);
              if (reduced) {
                const recovered = await openCandidate(index, reduced, false);
                currentContextRetryUsed = true;
                if ("opened" in recovered) {
                  currentResult = recovered.opened.result;
                  currentAttempt = recovered.opened.attempt;
                  currentOptions = recovered.opened.options;
                  continue;
                }
                retryFailure = recovered.failure;
                lastFailure = recovered.failure;
              }
            }

            if (
              (!retryFailure.failoverEligible && !isContextOverflowFailure(retryFailure))
              || index >= params.candidates.length - 1
            ) {
              controller.error(retryFailure);
              return;
            }

            let openedNext: OpenedStream | null = null;
            while (!openedNext && index < params.candidates.length - 1) {
              index += 1;
              if (!candidateEligible(index)) continue;
              const opened = await openCandidate(index, options, true);
              if ("opened" in opened) {
                openedNext = opened.opened;
                break;
              }
              lastFailure = opened.failure;
              if (
                !opened.failure.failoverEligible
                && !isContextOverflowFailure(opened.failure)
              ) {
                controller.error(opened.failure);
                return;
              }
            }
            if (!openedNext) {
              controller.error(lastFailure ?? retryFailure);
              return;
            }
            currentResult = openedNext.result;
            currentAttempt = openedNext.attempt;
            currentOptions = openedNext.options;
            currentContextRetryUsed = openedNext.contextRetryUsed;
          }
          controller.error(lastFailure ?? new Error("All language-model candidates failed"));
        })().catch((error) => controller.error(error));
      },
    });

    return {
      ...initialResult,
      stream: outer,
    };
  };

  return new Proxy(primary, {
    get(target, property, receiver) {
      if (property === "doGenerate") return doGenerate;
      if (property === "doStream") return doStream;
      if (property === "supportedUrls") return compositeSupportedUrls(params.candidates);
      return Reflect.get(target, property, receiver);
    },
  }) as LanguageModel;
}
