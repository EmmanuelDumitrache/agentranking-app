import type { ToolRuntimePolicy } from "../../shared/types";
import {
  DEFAULT_MAX_TOOL_STEPS,
  DEFAULT_TOOL_TIMEOUT_MS,
  DEFAULT_MAX_TOOL_CALLS_PER_RUN,
} from "../../shared/constants";
export function getDefaultToolPolicy(): ToolRuntimePolicy {
  return {
    maxToolSteps: DEFAULT_MAX_TOOL_STEPS,
    maxToolCallsPerRun: DEFAULT_MAX_TOOL_CALLS_PER_RUN,
    perToolTimeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
    redactInputForTools: [],
    modelMaxRetries: 2,
    toolRepairMaxAttempts: 1,
  };
}