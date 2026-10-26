import bs58 from "bs58";

const textDecoder = new TextDecoder("utf-8", { fatal: true });

export class Solana8004BorshReader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number { return this.bytes.byteLength - this.offset; }
  get position(): number { return this.offset; }

  private take(length: number, label: string): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {
      throw new Error(`${label} is truncated or exceeds the bounded event payload`);
    }
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  u8(label: string): number { return this.take(1, label)[0]!; }

  u16(label: string): number {
    const bytes = this.take(2, label);
    return new DataView(bytes.buffer, bytes.byteOffset, 2).getUint16(0, true);
  }

  bool(label: string): boolean {
    const value = this.u8(label);
    if (value === 0) return false;
    if (value === 1) return true;
    throw new Error(`${label} boolean value is invalid`);
  }

  u64(label: string): bigint {
    const bytes = this.take(8, label);
    let value = 0n;
    for (let index = 7; index >= 0; index -= 1) value = (value << 8n) | BigInt(bytes[index]!);
    return value;
  }

  i128(label: string): bigint {
    const bytes = this.take(16, label);
    let value = 0n;
    for (let index = 15; index >= 0; index -= 1) value = (value << 8n) | BigInt(bytes[index]!);
    return (value & (1n << 127n)) === 0n ? value : value - (1n << 128n);
  }

  pubkey(label: string): string { return bs58.encode(this.take(32, label)); }
  bytes32(label: string): string { return Buffer.from(this.take(32, label)).toString("hex"); }

  optionU8(label: string): number | null {
    const tag = this.u8(`${label} option tag`);
    if (tag === 0) return null;
    if (tag !== 1) throw new Error(`${label} option tag is invalid`);
    return this.u8(label);
  }

  optionBytes32(label: string): string | null {
    const tag = this.u8(`${label} option tag`);
    if (tag === 0) return null;
    if (tag !== 1) throw new Error(`${label} option tag is invalid`);
    return this.bytes32(label);
  }

  assertExhausted(label: string): void {
    if (this.remaining !== 0) throw new Error(`${label} has ${this.remaining} unexpected trailing byte(s)`);
  }

  string(label: string, maximumBytes: number): string {
    const lengthBytes = this.take(4, `${label} length`);
    const length = new DataView(lengthBytes.buffer, lengthBytes.byteOffset, 4).getUint32(0, true);
    if (length > maximumBytes) throw new Error(`${label} exceeds ${maximumBytes} bytes`);
    const raw = this.take(length, label);
    const value = textDecoder.decode(raw);
    if (/\0|[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
      throw new Error(`${label} contains a disallowed control character`);
    }
    return value.normalize("NFC");
  }
}

export function exactSignedFixedPoint(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error("Solana 8004 valueDecimals must be between 0 and 18");
  }
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  if (decimals === 0) return `${negative ? "-" : ""}${absolute}`;
  const divisor = 10n ** BigInt(decimals);
  const whole = absolute / divisor;
  const fraction = (absolute % divisor).toString(10).padStart(decimals, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
