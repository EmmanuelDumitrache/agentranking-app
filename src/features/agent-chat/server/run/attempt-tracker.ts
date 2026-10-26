import type { AgentChatModelDefinition } from "../../shared/model-registry-types";

export type TrackedRunAttempt = {
  attemptId: string;
  sequence: number;
  stepIndex: number;
  stepAttemptIndex: number;
  model: AgentChatModelDefinition;
};

export class AgentRunAttemptTracker {
  private sequence = 0;
  private readonly committedByStep = new Map<number, TrackedRunAttempt>();
  private active: TrackedRunAttempt | null = null;

  nextSequence(): number {
    const current = this.sequence;
    this.sequence += 1;
    return current;
  }

  setActiveAttempt(attempt: TrackedRunAttempt): void {
    this.active = attempt;
  }

  setCommittedAttempt(
    stepIndex: number,
    attempt: TrackedRunAttempt,
  ): void {
    this.committedByStep.set(stepIndex, attempt);
    this.active = attempt;
  }

  getCommittedAttempt(stepIndex: number): TrackedRunAttempt | undefined {
    return this.committedByStep.get(stepIndex);
  }

  completeCommittedAttempt(stepIndex: number): TrackedRunAttempt | undefined {
    const attempt = this.committedByStep.get(stepIndex);
    if (!attempt) return undefined;
    this.committedByStep.delete(stepIndex);
    if (this.active?.attemptId === attempt.attemptId) this.active = null;
    return attempt;
  }

  failAttempt(attemptId: string): void {
    if (this.active?.attemptId === attemptId) this.active = null;
    for (const [stepIndex, attempt] of this.committedByStep) {
      if (attempt.attemptId === attemptId) this.committedByStep.delete(stepIndex);
    }
  }

  getActiveAttempt(): TrackedRunAttempt | null {
    return this.active;
  }
}
