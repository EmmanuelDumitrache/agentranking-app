import { getMetaplexLastIndexError } from "@/lib/metaplex/index-error-store";
import {
  isExplicitMetaplexRpcConfigured,
  isHeliusApiKeyConfigured,
} from "@/lib/metaplex/rpc-config";
export type MetaplexOpsStatus = {
  rpcConfigured: boolean;
  heliusFallbackConfigured: boolean;
  lastIndexError: {
    assetAddress: string;
    message: string;
    at: string;
  } | null;
};
export function buildMetaplexOpsStatus(): MetaplexOpsStatus {
  return {
    rpcConfigured: isExplicitMetaplexRpcConfigured(),
    heliusFallbackConfigured: isHeliusApiKeyConfigured(),
    lastIndexError: getMetaplexLastIndexError(),
  };
}
