import * as OTPAuth from "otpauth";
import QRCode from "qrcode";

const ISSUER = "AgentRanking";
const TOTP_PERIOD_SECONDS = 30;

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function buildTotp(secretBase32: string, accountLabel: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: accountLabel,
    algorithm: "SHA1",
    digits: 6,
    period: TOTP_PERIOD_SECONDS,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export function totpUri(secretBase32: string, accountLabel: string): string {
  return buildTotp(secretBase32, accountLabel).toString();
}

export async function totpQrDataUrl(secretBase32: string, accountLabel: string): Promise<string> {
  return QRCode.toDataURL(totpUri(secretBase32, accountLabel), {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 220,
  });
}

export type TotpVerification =
  | { ok: true; step: bigint }
  | { ok: false };

/** Accept the current window ±1 for clock skew and return the matched RFC 6238 time-step. */
export function matchTotpCode(secretBase32: string, codeInput: string): TotpVerification {
  const digits = codeInput.replace(/\D/g, "");
  if (digits.length !== 6) return { ok: false };
  const delta = buildTotp(secretBase32, "verify").validate({ token: digits, window: 1 });
  if (delta === null || !Number.isSafeInteger(delta)) return { ok: false };
  const currentStep = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS);
  return { ok: true, step: BigInt(currentStep + delta) };
}

export function verifyTotpCode(secretBase32: string, codeInput: string): boolean {
  return matchTotpCode(secretBase32, codeInput).ok;
}
