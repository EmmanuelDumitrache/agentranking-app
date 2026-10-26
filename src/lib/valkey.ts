import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { z } from "zod";
import { stringifyJsonCompatible } from "@/lib/json-compatible";

function createValkeyClient(url: string) {
  return createClient({
    RESP: 3,
    url,
    disableOfflineQueue: true,
    commandsQueueMaxLength: 1_000,
    socket: {
      connectTimeout: 2_000,
      reconnectStrategy(retries) {
        return Math.min(100 * 2 ** Math.min(retries, 5), 2_000);
      },
    },
  });
}

export type ValkeyClient = ReturnType<typeof createValkeyClient>;

export type ValkeyLeaseContext = {
  key: string;
  token: string;
};

type GlobalValkeyState = {
  client?: ValkeyClient;
  connectPromise?: Promise<ValkeyClient>;
  closePromise?: Promise<void>;
  url?: string;
};

const globalForValkey = globalThis as typeof globalThis & {
  __agentrankingValkey?: GlobalValkeyState;
};
const state = (globalForValkey.__agentrankingValkey ??= {});

export type SlidingWindowResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
};

export type SlidingWindowRule = {
  key: string;
  limit: number;
  windowMs: number;
};

export class ValkeyLeaseBusyError extends Error {
  readonly key: string;

  constructor(key: string) {
    super("The requested operation is already in progress.");
    this.name = "ValkeyLeaseBusyError";
    this.key = key;
  }
}

export class ValkeyLeaseLostError extends Error {
  readonly key: string;

  constructor(key: string, cause?: unknown) {
    super("The distributed operation lease was lost.", { cause });
    this.name = "ValkeyLeaseLostError";
    this.key = key;
  }
}

const DELETE_IF_VALUE_MATCHES_LUA = `
redis.setresp(3)
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const LEASE_RENEW_LUA = `
redis.setresp(3)
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const LEASE_RELEASE_LUA = `
redis.setresp(3)
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const LEASE_PUBLISH_JSON_LUA = `
redis.setresp(3)
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[2])
  return 1
end
return 0
`;

const SLIDING_WINDOW_MANY_LUA = `
redis.setresp(3)
local now = tonumber(ARGV[1])
local member = ARGV[2]
if now == nil or now < 0 then return redis.error_reply('invalid current time') end
local allowed = 1
local counts = {}
local resets = {}

for i = 1, #KEYS do
  local window = tonumber(ARGV[1 + i * 2])
  local limit = tonumber(ARGV[2 + i * 2])
  if window == nil or window < 1 or limit == nil or limit < 1 then
    return redis.error_reply('invalid rate-limit rule')
  end
  local cutoff = now - window
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', cutoff)
  local count = redis.call('ZCARD', KEYS[i])
  counts[i] = count
  local oldest = redis.call('ZRANGE', KEYS[i], 0, 0, 'WITHSCORES')
  local oldestScore = nil
  if type(oldest[1]) == 'table' then
    oldestScore = oldest[1][2]
  else
    oldestScore = oldest[2]
  end
  local reset = now + window
  local parsedOldest = oldestScore and tonumber(oldestScore) or nil
  if parsedOldest ~= nil then reset = parsedOldest + window end
  resets[i] = reset
  if count >= limit then allowed = 0 end
end

local response = {allowed, #KEYS}
for i = 1, #KEYS do
  local window = tonumber(ARGV[1 + i * 2])
  local limit = tonumber(ARGV[2 + i * 2])
  local count = counts[i]
  if allowed == 1 then
    redis.call('ZADD', KEYS[i], now, member)
    count = count + 1
    counts[i] = count
    if count == 1 then resets[i] = now + window end
  end
  redis.call('PEXPIRE', KEYS[i], window)
  response[#response + 1] = limit
  response[#response + 1] = math.max(0, limit - count)
  response[#response + 1] = resets[i]
end
return response
`;

function configuredUrl(): string {
  const raw = process.env.VALKEY_URL?.trim() ?? "";
  if (!raw) throw new Error("VALKEY_URL is required");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new Error("VALKEY_URL must be a valid redis:// or rediss:// URL", { cause: error });
  }
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error("VALKEY_URL must use redis:// or rediss://");
  }
  return raw;
}

async function destroyClient(client: ValkeyClient): Promise<void> {
  if (!client.isOpen) return;
  try {
    await client.quit();
  } catch (error) {
    if (client.isOpen) {
      const destroy = (client as ValkeyClient & { destroy?: () => void }).destroy;
      destroy?.call(client);
    }
    throw error;
  }
}

/** Close the process-wide Valkey connection. New callers wait for close before reconnecting. */
export async function closeValkeyClient(): Promise<void> {
  if (state.closePromise) return state.closePromise;
  const client = state.client;
  const connecting = state.connectPromise;
  state.client = undefined;
  state.connectPromise = undefined;
  state.url = undefined;
  const closing = (async () => {
    const errors: unknown[] = [];
    if (connecting) {
      try {
        await connecting;
      } catch {
        // The connection failure is already observed by its caller; cleanup below is still required.
      }
    }
    if (client) {
      try {
        await destroyClient(client);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Valkey client shutdown failed");
  })().finally(() => {
    if (state.closePromise === closing) state.closePromise = undefined;
  });
  state.closePromise = closing;
  return closing;
}

export async function getValkeyClient(): Promise<ValkeyClient> {
  if (state.closePromise) await state.closePromise;
  const url = configuredUrl();
  if (state.client && state.url === url && state.client.isReady) return state.client;
  if (state.url !== undefined && state.url !== url) {
    await closeValkeyClient();
  }
  if (state.connectPromise && state.url === url) return state.connectPromise;
  if (state.client && state.url === url && state.client.isOpen && !state.client.isReady) {
    throw new Error("Valkey client is open but not ready");
  }
  if (state.client && !state.client.isOpen) state.client = undefined;

  const client = createValkeyClient(url);
  client.on("error", (error) => {
    console.error("[valkey] client error:", Error.isError(error) ? error.message : String(error));
  });
  state.client = client;
  state.url = url;
  const connectPromise: Promise<ValkeyClient> = client
    .connect()
    .then(() => {
      if (state.client !== client || state.url !== url) {
        return destroyClient(client).then(() => {
          throw new Error("Valkey connection was superseded during startup");
        });
      }
      if (!client.isReady) throw new Error("Valkey connection completed without becoming ready");
      return client;
    })
    .catch(async (error) => {
      if (state.client === client) state.client = undefined;
      if (state.url === url) state.url = undefined;
      try {
        await destroyClient(client);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Valkey connection and cleanup failed");
      }
      throw error;
    })
    .finally(() => {
      if (state.connectPromise === connectPromise) state.connectPromise = undefined;
    });
  state.connectPromise = connectPromise;
  return connectPromise;
}

export async function valkeyGetString(key: string): Promise<string | null> {
  const client = await getValkeyClient();
  return client.get(key);
}

export async function valkeyGetJson<T = unknown>(key: string): Promise<T | null> {
  const raw = await valkeyGetString(key);
  if (raw === null) return null;
  return JSON.parse(raw) as T;
}

/**
 * Read and validate a JSON value using a Zod schema.
 * Invalid data is removed only if the exact bytes read are still present.
 */
export async function valkeyGetSchemaJson<S extends z.ZodType>(
  key: string,
  schema: S,
): Promise<z.output<S> | null> {
  const raw = await valkeyGetString(key);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await valkeyDeleteIfValueMatches(key, raw);
    return null;
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    await valkeyDeleteIfValueMatches(key, raw);
    return null;
  }
  return result.data;
}

/**
 * Read and validate a JSON value. Invalid data is removed only if the exact bytes read are
 * still present, so validation cleanup cannot delete a concurrent fresh publication.
 */
export async function valkeyGetValidatedJson<T>(
  key: string,
  validate: (candidate: unknown) => candidate is T,
): Promise<T | null> {
  const raw = await valkeyGetString(key);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    await valkeyDeleteIfValueMatches(key, raw);
    return null;
  }
  try {
    if (validate(parsed)) return parsed;
  } catch {
    // Treat validator exceptions as invalid cache data.
  }
  await valkeyDeleteIfValueMatches(key, raw);
  return null;
}

export async function valkeySetStringPx(
  key: string,
  value: string,
  ttlMs: number,
): Promise<void> {
  const client = await getValkeyClient();
  const boundedTtlMs = Math.min(30 * 24 * 60 * 60_000, Math.max(1, Math.trunc(ttlMs)));
  await client.set(key, value, { PX: boundedTtlMs });
}

export async function valkeySetStringNxPx(
  key: string,
  value: string,
  ttlMs: number,
): Promise<boolean> {
  const client = await getValkeyClient();
  const boundedTtlMs = Math.min(30 * 24 * 60 * 60_000, Math.max(1, Math.trunc(ttlMs)));
  const result = await client.set(key, value, { NX: true, PX: boundedTtlMs });
  return result === "OK";
}

export async function valkeyDeleteKeys(keys: readonly string[]): Promise<number> {
  if (keys.length === 0) return 0;
  const client = await getValkeyClient();
  return client.del([...keys]);
}

export async function valkeyIncrement(key: string): Promise<number> {
  const client = await getValkeyClient();
  const value = await client.incr(key);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Valkey returned an invalid increment result for ${key}`);
  }
  return value;
}


export async function valkeyDeleteIfValueMatches(key: string, expected: string): Promise<boolean> {
  const result = await valkeyEval({
    script: DELETE_IF_VALUE_MATCHES_LUA,
    keys: [key],
    args: [expected],
  });
  return Number(result) === 1;
}

export async function valkeyEval(input: {
  script: string;
  keys: readonly string[];
  args?: readonly string[];
}): Promise<unknown> {
  const client = await getValkeyClient();
  return client.sendCommand([
    "EVAL",
    input.script,
    String(input.keys.length),
    ...input.keys,
    ...(input.args ?? []),
  ]);
}

export async function valkeySetJson(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  const client = await getValkeyClient();
  const boundedTtlSeconds = Math.min(30 * 24 * 60 * 60, Math.max(1, Math.trunc(ttlSeconds)));
  await client.set(key, stringifyJsonCompatible(value), { EX: boundedTtlSeconds });
}

export async function valkeySetJsonIfLeaseOwner(input: {
  key: string;
  leaseKey: string;
  token: string;
  value: unknown;
  ttlSeconds: number;
}): Promise<boolean> {
  const client = await getValkeyClient();
  const boundedTtlSeconds = Math.min(
    30 * 24 * 60 * 60,
    Math.max(1, Math.trunc(input.ttlSeconds)),
  );
  const serialized = stringifyJsonCompatible(input.value);
  const result = await client.sendCommand([
    "EVAL",
    LEASE_PUBLISH_JSON_LUA,
    "2",
    input.leaseKey,
    input.key,
    input.token,
    String(boundedTtlSeconds),
    serialized,
  ]);
  return Number(result) === 1;
}

async function valkeyServerTimeMs(): Promise<number> {
  const client = await getValkeyClient();
  const result = await client.sendCommand(["TIME"]);
  if (!Array.isArray(result) || result.length !== 2) {
    throw new Error("Unexpected Valkey TIME response");
  }
  const seconds = Number(result[0]);
  const microseconds = Number(result[1]);
  const now = seconds * 1_000 + Math.floor(microseconds / 1_000);
  if (
    !Number.isSafeInteger(seconds) ||
    seconds < 0 ||
    !Number.isSafeInteger(microseconds) ||
    microseconds < 0 ||
    microseconds >= 1_000_000 ||
    !Number.isSafeInteger(now)
  ) {
    throw new Error("Invalid Valkey TIME response");
  }
  return now;
}

export async function slidingWindowLimitMany(
  rules: readonly SlidingWindowRule[],
): Promise<{ success: boolean; results: SlidingWindowResult[] }> {
  if (rules.length === 0) return { success: true, results: [] };
  if (rules.length > 32) throw new RangeError("At most 32 rate-limit rules may be evaluated together");
  const normalized = rules.map((rule) => ({
    key: rule.key,
    limit: Math.max(1, Math.trunc(rule.limit)),
    windowMs: Math.max(1, Math.trunc(rule.windowMs)),
  }));
  for (const rule of normalized) {
    if (!rule.key.trim() || rule.key.length > 512) {
      throw new RangeError("Rate-limit keys must contain 1-512 characters");
    }
  }
  const now = await valkeyServerTimeMs();
  const result = await valkeyEval({
    script: SLIDING_WINDOW_MANY_LUA,
    keys: normalized.map((rule) => rule.key),
    args: [
      String(now),
      `${now}:${randomUUID()}`,
      ...normalized.flatMap((rule) => [String(rule.windowMs), String(rule.limit)]),
    ],
  });
  if (!Array.isArray(result) || result.length !== 2 + normalized.length * 3) {
    throw new Error("Unexpected Valkey rate-limit response");
  }
  const allowedRaw = Number(result[0]);
  if (allowedRaw !== 0 && allowedRaw !== 1) throw new Error("Invalid Valkey rate-limit decision");
  const success = allowedRaw === 1;
  const count = Number(result[1]);
  if (!Number.isSafeInteger(count) || count !== normalized.length) {
    throw new Error("Unexpected Valkey rate-limit rule count");
  }
  return {
    success,
    results: normalized.map((rule, index) => {
      const offset = 2 + index * 3;
      const limit = Number(result[offset]);
      const remaining = Number(result[offset + 1]);
      const reset = Number(result[offset + 2]);
      if (
        !Number.isSafeInteger(limit) ||
        limit !== rule.limit ||
        !Number.isSafeInteger(remaining) ||
        remaining < 0 ||
        remaining > limit ||
        !Number.isSafeInteger(reset) ||
        reset < now ||
        reset > now + rule.windowMs
      ) {
        throw new Error(`Invalid Valkey rate-limit result for ${rule.key}`);
      }
      return { success, limit, remaining, reset };
    }),
  };
}

export async function slidingWindowLimit(input: SlidingWindowRule): Promise<SlidingWindowResult> {
  const result = await slidingWindowLimitMany([input]);
  return result.results[0]!;
}

export async function valkeyPublish(channel: string, message: string): Promise<number> {
  const client = await getValkeyClient();
  return client.publish(channel, message);
}

export async function subscribeValkeyChannel(
  channel: string,
  listener: (message: string) => void,
): Promise<() => Promise<void>> {
  const commandClient = await getValkeyClient();
  const subscriber = commandClient.duplicate();
  subscriber.on("error", (error) => {
    console.error(
      `[valkey] subscriber error for ${channel}:`,
      Error.isError(error) ? error.message : String(error),
    );
  });
  try {
    await subscriber.connect();
    await subscriber.subscribe(channel, listener);
  } catch (error) {
    try {
      await destroyClient(subscriber);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `Valkey subscription startup failed for ${channel}`);
    }
    throw error;
  }
  let closed = false;
  return async () => {
    if (closed) return;
    closed = true;
    const errors: unknown[] = [];
    if (subscriber.isOpen) {
      try {
        await subscriber.unsubscribe(channel);
      } catch (error) {
        errors.push(error);
      }
      try {
        await destroyClient(subscriber);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, `Valkey subscription shutdown failed for ${channel}`);
    }
  };
}

export async function tryAcquireValkeyLease(input: {
  key: string;
  token: string;
  ttlMs: number;
}): Promise<boolean> {
  const client = await getValkeyClient();
  const ttlMs = Math.min(60 * 60_000, Math.max(1, Math.trunc(input.ttlMs)));
  const result = await client.set(input.key, input.token, {
    NX: true,
    PX: ttlMs,
  });
  return result === "OK";
}

export async function renewValkeyLease(input: {
  key: string;
  token: string;
  ttlMs: number;
}): Promise<boolean> {
  const client = await getValkeyClient();
  const result = await client.sendCommand([
    "EVAL",
    LEASE_RENEW_LUA,
    "1",
    input.key,
    input.token,
    String(Math.min(60 * 60_000, Math.max(1, Math.trunc(input.ttlMs)))),
  ]);
  return Number(result) === 1;
}

export async function releaseValkeyLease(input: {
  key: string;
  token: string;
}): Promise<boolean> {
  const client = await getValkeyClient();
  const result = await client.sendCommand([
    "EVAL",
    LEASE_RELEASE_LUA,
    "1",
    input.key,
    input.token,
  ]);
  return Number(result) === 1;
}

export async function withValkeyLease<T>(
  input: {
    key: string;
    ttlMs: number;
    renewEveryMs?: number;
  },
  operation: (signal: AbortSignal, lease: ValkeyLeaseContext) => Promise<T>,
): Promise<T> {
  const key = input.key.trim();
  if (!key || key.length > 512) throw new Error("Valkey lease key must contain 1-512 characters");
  const ttlMs = Math.min(60 * 60_000, Math.max(2_000, Math.trunc(input.ttlMs)));
  const renewEveryMs = Math.min(
    Math.max(500, Math.trunc(input.renewEveryMs ?? Math.floor(ttlMs / 3))),
    Math.max(500, Math.floor(ttlMs / 2)),
  );
  const token = randomUUID();
  const acquired = await tryAcquireValkeyLease({ key, token, ttlMs });
  if (!acquired) throw new ValkeyLeaseBusyError(key);

  const lost = new AbortController();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const activeRenewals = new Set<Promise<void>>();
  const scheduleRenewal = (): void => {
    if (stopped || lost.signal.aborted) return;
    timer = setTimeout(() => {
      timer = null;
      const renewal = renewValkeyLease({ key, token, ttlMs })
        .then((renewed) => {
          if (!renewed && !lost.signal.aborted) lost.abort(new ValkeyLeaseLostError(key));
        })
        .catch((error) => {
          if (!lost.signal.aborted) lost.abort(new ValkeyLeaseLostError(key, error));
        });
      activeRenewals.add(renewal);
      void renewal.finally(() => {
        activeRenewals.delete(renewal);
        scheduleRenewal();
      });
    }, renewEveryMs);
    timer.unref?.();
  };
  scheduleRenewal();

  let value: T | undefined;
  let primaryError: unknown;
  try {
    value = await operation(lost.signal, { key, token });
    if (lost.signal.aborted) {
      throw lost.signal.reason instanceof Error
        ? lost.signal.reason
        : new ValkeyLeaseLostError(key, lost.signal.reason);
    }
  } catch (error) {
    primaryError = error;
  }

  stopped = true;
  if (timer) clearTimeout(timer);
  await Promise.allSettled([...activeRenewals]);

  const cleanupErrors: unknown[] = [];
  if (lost.signal.aborted && primaryError !== lost.signal.reason) {
    cleanupErrors.push(
      lost.signal.reason instanceof Error
        ? lost.signal.reason
        : new ValkeyLeaseLostError(key, lost.signal.reason),
    );
  }
  try {
    const released = await releaseValkeyLease({ key, token });
    if (!released && !lost.signal.aborted) cleanupErrors.push(new ValkeyLeaseLostError(key));
  } catch (error) {
    cleanupErrors.push(error);
  }

  const errors = primaryError === undefined ? cleanupErrors : [primaryError, ...cleanupErrors];
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, `Valkey lease operation failed for ${key}`);
  return value as T;
}
