import "server-only";

import type { ToolSet } from "ai";

export type AgentToolEffect = {
  stateChanging: boolean;
};

const effects = new WeakMap<object, AgentToolEffect>();

function asObject(tool: ToolSet[string]): object | null {
  return typeof tool === "object" && tool !== null ? tool : null;
}

/**
 * Attach execution-effect metadata without altering the AI SDK tool schema.
 * The runtime uses this for side-effect idempotency and for lossless context
 * policies that retain mutation evidence longer than ordinary read results.
 * It does not itself gate whether a tool is exposed or executable.
 */
export function markToolEffect<T extends ToolSet[string]>(
  tool: T,
  effect: AgentToolEffect,
): T {
  const target = asObject(tool);
  if (target) effects.set(target, effect);
  return tool;
}

export function getToolEffect(tool: ToolSet[string]): AgentToolEffect | null {
  const target = asObject(tool);
  return target ? effects.get(target) ?? null : null;
}

export function copyToolEffect(
  source: ToolSet[string],
  target: ToolSet[string],
): void {
  const effect = getToolEffect(source);
  const targetObject = asObject(target);
  if (effect && targetObject) effects.set(targetObject, effect);
}
