import { encodeURL } from "@solana/pay";
import { address } from "@solana/kit";

export type BuildSolanaPayUrlInput = {
  recipient: string;
  amount: string;
  reference: string;
  label: string;
  message: string;
  memo?: string;
  splToken?: string;
};
export function buildSolanaPayTransferUrl(input: BuildSolanaPayUrlInput): string {
  const { recipient, amount, reference, label, message, memo, splToken } = input;
  const url = encodeURL({
    recipient: address(recipient),
    amount: parseFloat(amount),
    reference: address(reference),
    label,
    message,
    memo,
    splToken: splToken ? address(splToken) : undefined,
  });
  return url.toString();
}