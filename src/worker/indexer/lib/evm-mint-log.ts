import { parseData32, parseRpcData } from "./exact-protocol.js";
export const ERC721_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const EVM_ZERO_TOPIC = "0x0000000000000000000000000000000000000000000000000000000000000000";
export type RawEvmMintLog = {
  address?: unknown;
  topics?: unknown;
  data?: unknown;
};
/** Strictly decode an ERC-721 mint Transfer log without passing uint256 through Number. */
export function parseErc721MintTokenId(log: RawEvmMintLog, registry: string): string {
  if (typeof log.address !== "string" || log.address.toLowerCase() !== registry.toLowerCase()) {
    throw new Error("mint Transfer log came from the wrong registry address");
  }
  if (!Array.isArray(log.topics) || log.topics.length !== 4) {
    throw new Error("mint Transfer log has the wrong topic count");
  }
  const signature = parseData32(log.topics[0], "Transfer signature topic");
  const from = parseData32(log.topics[1], "Transfer from topic");
  parseData32(log.topics[2], "Transfer to topic");
  const tokenId = parseData32(log.topics[3], "Transfer token id topic");
  parseRpcData(log.data, 0, "Transfer event data");
  if (signature !== ERC721_TRANSFER_TOPIC || from !== EVM_ZERO_TOPIC) {
    throw new Error("log is not an ERC-721 mint Transfer");
  }
  return BigInt(tokenId).toString(10);
}
export function compareCanonicalUnsignedDecimal(left: string, right: string): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}
