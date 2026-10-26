import "server-only";

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /^(?:authorization|proxy[-_]?authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|bearer[-_]?token|identity[-_]?token|client[-_]?secret|webhook[-_]?secret|password|passwd|private[-_]?key|secret|secret[-_]?key|seed(?:[-_]?phrase)?|mnemonic|cvv|cvc|card[-_]?number|pan|otp|one[-_]?time[-_]?code|verification[-_]?code|three[-_]?ds(?:[-_]?code)?|3ds(?:[-_]?code)?|signed[-_]?payload|provider[-_]?credential|credential[-_]?secret)$/i;
const SENSITIVE_SUFFIX = /(?:ApiKey|AccessToken|RefreshToken|AuthToken|BearerToken|IdentityToken|ClientSecret|WebhookSecret|PrivateKey|SecretKey|SeedPhrase|CardNumber|Otp|OneTimeCode|VerificationCode|ThreeDsCode|SignedPayload|CredentialSecret)$/;
const AUTH_HEADER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const GOOGLE_API_KEY = /\bAIza[0-9A-Za-z_-]{20,}\b/g;
const GENERIC_SECRET_KEY = /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9_-]{12,}\b/g;
const OPENAI_STYLE_KEY = /\bsk-[A-Za-z0-9_-]{16,}\b/g;
const LABELED_SECRET = /(\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|authorization|password|passwd|secret|client[-_ ]?secret|private[-_ ]?key|seed[-_ ]?phrase|mnemonic|cvv|cvc)\b\s*[:=]\s*)([^\s,;"'}]+)/gi;
const URL_SECRET_PARAM = /([#?&](?:api[-_]?key|key|secret[-_]?key|access_token|refresh_token|identity_token|token|auth|authorization|signature|sig)=)([^&#\s]+)/gi;
const CARD_CANDIDATE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;

function luhn(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function redactCardCandidate(candidate: string): string {
  if (!luhn(candidate)) return candidate;
  const digits = candidate.replace(/\D/g, "");
  return `[REDACTED_CARD_••••${digits.slice(-4)}]`;
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(AUTH_HEADER, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(GOOGLE_API_KEY, "[REDACTED_GOOGLE_API_KEY]")
    .replace(GENERIC_SECRET_KEY, "[REDACTED_API_KEY]")
    .replace(OPENAI_STYLE_KEY, "[REDACTED_API_KEY]")
    .replace(LABELED_SECRET, (_match, prefix: string) => `${prefix}${REDACTED}`)
    .replace(URL_SECRET_PARAM, (_match, prefix: string) => `${prefix}${REDACTED}`)
    .replace(CARD_CANDIDATE, redactCardCandidate);
}

/** Redacts exact in-memory credential values that may be echoed by an external service. */
export function redactExactSensitiveValues<T>(value: T, rawSecrets: readonly string[]): T {
  const secrets = [...new Set(rawSecrets.map((secret) => secret.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  if (!secrets.length) return value;
  const redactString = (input: string): string => secrets.reduce((output, secret) => {
    if (secret.length >= 8) return output.replaceAll(secret, REDACTED);
    return output === secret ? REDACTED : output;
  }, input);
  const seen = new WeakMap<object, unknown>();
  const visit = (input: unknown): unknown => {
    if (typeof input === "string") return redactString(input);
    if (input === null || typeof input !== "object") return input;
    const existing = seen.get(input);
    if (existing) return existing;
    if (Array.isArray(input)) {
      const output: unknown[] = [];
      seen.set(input, output);
      input.forEach((entry) => output.push(visit(entry)));
      return output;
    }
    const output: Record<string, unknown> = {};
    seen.set(input, output);
    for (const [key, entry] of Object.entries(input as Record<string, unknown>)) {
      output[key] = visit(entry);
    }
    return output;
  };
  return visit(value) as T;
}

function shouldRedactKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) || SENSITIVE_SUFFIX.test(key);
}

export function redactSensitiveData<T>(value: T): T {
  const seen = new WeakMap<object, unknown>();
  const visit = (input: unknown): unknown => {
    if (typeof input === "string") return redactSensitiveText(input);
    if (
      input === null ||
      typeof input === "number" ||
      typeof input === "boolean" ||
      typeof input === "undefined"
    ) {
      return input;
    }
    // Durable JSON/logging boundaries cannot represent bigint. Normalize it
    // while traversing so redacted tool/provider payloads remain serializable.
    if (typeof input === "bigint") return input.toString();
    if (Error.isError(input)) {
      return {
        name: input.name,
        message: redactSensitiveText(input.message),
      };
    }
    if (Array.isArray(input)) {
      const existing = seen.get(input);
      if (existing) return existing;
      const output: unknown[] = [];
      seen.set(input, output);
      for (const item of input) output.push(visit(item));
      return output;
    }
    if (typeof input === "object") {
      const object = input as Record<string, unknown>;
      const existing = seen.get(object);
      if (existing) return existing;
      const output: Record<string, unknown> = {};
      seen.set(object, output);
      for (const [key, item] of Object.entries(object)) {
        output[key] = shouldRedactKey(key) ? REDACTED : visit(item);
      }
      return output;
    }
    return String(input);
  };
  return visit(value) as T;
}

export function safeErrorDetails(error: unknown): {
  name: string;
  message: string;
  code?: string;
} {
  if (Error.isError(error)) {
    const code = (error as Error & { code?: unknown }).code;
    return {
      name: error.name,
      message: redactSensitiveText(error.message),
      ...(typeof code === "string" ? { code: redactSensitiveText(code) } : {}),
    };
  }
  return { name: "Error", message: redactSensitiveText(String(error)) };
}
