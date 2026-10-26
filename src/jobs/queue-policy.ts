import type { QueueResult, UpdateQueueOptions } from "pg-boss";
/**
 * pg-boss 12.27 accepts null for retryDelayMax at runtime so an existing cap
 * can be cleared, but its public TypeScript declaration still only exposes
 * number. Keep the compatibility cast at the pg-boss call boundary.
 */
export type PgBossQueueOptions = Omit<UpdateQueueOptions, "retryDelayMax"> & {
  retryDelayMax?: number | null;
};
export type PgBossQueueDefinition = {
  name: string;
  options: PgBossQueueOptions;
};
export function asPgBossQueueOptions(options: PgBossQueueOptions): UpdateQueueOptions {
  return options as unknown as UpdateQueueOptions;
}
function assertIntegerAtLeast(
  queueName: string,
  optionName: string,
  value: unknown,
  minimum: number,
): asserts value is number {
  if (!Number.isInteger(value) || Number(value) < minimum) {
    throw new Error(
      `Invalid pg-boss queue policy for ${queueName}: ${optionName} must be an integer >= ${minimum}`,
    );
  }
}
export function assertPgBossQueueOptions(
  queueName: string,
  options: PgBossQueueOptions,
): void {
  if (options.retryDelay !== undefined) {
    assertIntegerAtLeast(queueName, "retryDelay", options.retryDelay, 0);
  }
  if (options.retryLimit !== undefined) {
    assertIntegerAtLeast(queueName, "retryLimit", options.retryLimit, 0);
  }
  if (
    options.retryBackoff !== undefined &&
    options.retryBackoff !== true &&
    options.retryBackoff !== false
  ) {
    throw new Error(
      `Invalid pg-boss queue policy for ${queueName}: retryBackoff must be boolean`,
    );
  }
  if (options.retryDelayMax !== undefined && options.retryDelayMax !== null) {
    if (options.retryBackoff !== true) {
      throw new Error(
        `Invalid pg-boss queue policy for ${queueName}: retryDelayMax requires retryBackoff=true`,
      );
    }
    assertIntegerAtLeast(queueName, "retryDelayMax", options.retryDelayMax, 0);
  }
  if (options.expireInSeconds !== undefined) {
    assertIntegerAtLeast(queueName, "expireInSeconds", options.expireInSeconds, 1);
    if (options.expireInSeconds >= 24 * 60 * 60) {
      throw new Error(
        `Invalid pg-boss queue policy for ${queueName}: expireInSeconds must be less than 24 hours`,
      );
    }
  }
  if (options.retentionSeconds !== undefined) {
    assertIntegerAtLeast(queueName, "retentionSeconds", options.retentionSeconds, 1);
  }
  if (options.deleteAfterSeconds !== undefined) {
    assertIntegerAtLeast(queueName, "deleteAfterSeconds", options.deleteAfterSeconds, 0);
  }
  if (options.heartbeatSeconds !== undefined && options.heartbeatSeconds !== null) {
    assertIntegerAtLeast(queueName, "heartbeatSeconds", options.heartbeatSeconds, 10);
  }
  if (options.warningQueueSize !== undefined) {
    assertIntegerAtLeast(queueName, "warningQueueSize", options.warningQueueSize, 1);
  }
  if (options.notify !== undefined && typeof options.notify !== "boolean") {
    throw new Error(
      `Invalid pg-boss queue policy for ${queueName}: notify must be boolean`,
    );
  }
  if (options.deadLetter !== undefined && typeof options.deadLetter !== "string") {
    throw new Error(
      `Invalid pg-boss queue policy for ${queueName}: deadLetter must be a string`,
    );
  }
}
export function assertPgBossQueueDefinitions(
  definitions: readonly PgBossQueueDefinition[],
): void {
  const names = new Set<string>();
  for (const definition of definitions) {
    if (names.has(definition.name)) {
      throw new Error(`Duplicate pg-boss queue definition: ${definition.name}`);
    }
    names.add(definition.name);
    assertPgBossQueueOptions(definition.name, definition.options);
    if (definition.options.deadLetter === definition.name) {
      throw new Error(`Invalid pg-boss queue policy for ${definition.name}: deadLetter cannot be itself`);
    }
  }
  for (const definition of definitions) {
    const deadLetter = definition.options.deadLetter;
    if (deadLetter && !names.has(deadLetter)) {
      throw new Error(
        `Invalid pg-boss queue policy for ${definition.name}: unknown deadLetter queue ${deadLetter}`,
      );
    }
  }
}
/**
 * pg-boss validates a queue's dead-letter target during createQueue().
 * Fresh-schema migrations must therefore create every dependency before the
 * queue that references it. Keep declaration order for otherwise-independent
 * queues so policy digests and operator output remain stable.
 */
export function orderPgBossQueueDefinitionsForCreation<
  T extends PgBossQueueDefinition,
>(definitions: readonly T[]): readonly T[] {
  assertPgBossQueueDefinitions(definitions);
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  const state = new Map<string, "visiting" | "visited">();
  const ordered: T[] = [];

  const visit = (definition: T, ancestry: readonly string[]): void => {
    const currentState = state.get(definition.name);
    if (currentState === "visited") return;
    if (currentState === "visiting") {
      throw new Error(
        `Invalid pg-boss queue policy: dead-letter dependency cycle ${[...ancestry, definition.name].join(" -> ")}`,
      );
    }

    state.set(definition.name, "visiting");
    const deadLetter = definition.options.deadLetter;
    if (deadLetter) {
      const dependency = byName.get(deadLetter);
      if (!dependency) {
        // assertPgBossQueueDefinitions() already reports this, but retain the
        // guard so this helper remains correct if validation changes later.
        throw new Error(
          `Invalid pg-boss queue policy for ${definition.name}: unknown deadLetter queue ${deadLetter}`,
        );
      }
      visit(dependency, [...ancestry, definition.name]);
    }
    state.set(definition.name, "visited");
    ordered.push(definition);
  };

  for (const definition of definitions) visit(definition, []);
  return ordered;
}

const MUTABLE_QUEUE_OPTION_KEYS = [
  "retryLimit",
  "retryDelay",
  "retryBackoff",
  "retryDelayMax",
  "expireInSeconds",
  "retentionSeconds",
  "deleteAfterSeconds",
  "deadLetter",
  "heartbeatSeconds",
  "notify",
  "warningQueueSize",
] as const;
export function assertPgBossQueueMatches(
  queueName: string,
  actual: QueueResult,
  expected: PgBossQueueOptions,
): void {
  for (const key of MUTABLE_QUEUE_OPTION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(expected, key)) continue;
    const expectedValue = expected[key];
    const actualValue = actual[key];
    if (!Object.is(actualValue, expectedValue)) {
      throw new Error(
        `pg-boss queue option drift for ${queueName}.${key}: ${String(actualValue)} != ${String(expectedValue)}`,
      );
    }
  }
}