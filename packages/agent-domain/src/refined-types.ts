/**
 * Refined domain types and constructors without runtime library dependencies.
 */

export const INT32_MAX = 2_147_483_647;

declare const agentDbIdBrand: unique symbol;

export type AgentDbId = number & {
  readonly [agentDbIdBrand]: true;
};

export function createAgentDbId(value: number): AgentDbId {
  if (!Number.isSafeInteger(value) || value <= 0 || value > INT32_MAX) {
    throw new TypeError(`AgentDbId must be a positive 32-bit safe integer (got ${value})`);
  }
  return value as AgentDbId;
}

export function tryCreateAgentDbId(value: unknown): AgentDbId | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > INT32_MAX) {
    return null;
  }
  return value as AgentDbId;
}

declare const positiveSafeIntBrand: unique symbol;

export type PositiveSafeInt = number & {
  readonly [positiveSafeIntBrand]: true;
};

export function createPositiveSafeInt(value: number, label = "value"): PositiveSafeInt {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer (got ${value})`);
  }
  return value as PositiveSafeInt;
}

declare const nonNegativeSafeIntBrand: unique symbol;

export type NonNegativeSafeInt = number & {
  readonly [nonNegativeSafeIntBrand]: true;
};

export function createNonNegativeSafeInt(value: number, label = "value"): NonNegativeSafeInt {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer (got ${value})`);
  }
  return value as NonNegativeSafeInt;
}

declare const durationMsBrand: unique symbol;

export type DurationMs = number & {
  readonly [durationMsBrand]: true;
};

export function createDurationMs(value: number, label = "durationMs"): DurationMs {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer representing milliseconds (got ${value})`);
  }
  return value as DurationMs;
}

declare const basisPointsBrand: unique symbol;

export type BasisPoints = number & {
  readonly [basisPointsBrand]: true;
};

export function createBasisPoints(value: number, label = "basisPoints"): BasisPoints {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new TypeError(`${label} must be an integer between 0 and 10000 basis points (got ${value})`);
  }
  return value as BasisPoints;
}

declare const validDateBrand: unique symbol;

export type ValidDate = Date & {
  readonly [validDateBrand]: true;
};

export function createValidDate(value: Date | string | number): ValidDate {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`Invalid date: ${String(value)}`);
  }
  return d as ValidDate;
}
