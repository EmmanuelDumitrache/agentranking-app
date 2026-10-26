import {
  isGenesisApiError,
  isGenesisApiNetworkError,
  isGenesisValidationError,
} from "@metaplex-foundation/genesis";
import {
  isAgentApiError,
  isAgentApiNetworkError,
  isAgentValidationError,
} from "@metaplex-foundation/mpl-agent-registry";
export type MetaplexLaunchErrorCode =
  | "invalid_image_host"
  | "invalid_field_length"
  | "wallet_missing"
  | "insufficient_sol"
  | "rpc_timeout"
  | "blockhash_expired"
  | "metaplex_api_unreachable"
  | "metaplex_api_validation"
  | "metaplex_api_server"
  | "agent_not_registered"
  | "agent_submission_uncertain"
  | "genesis_submission_uncertain"
  | "wallet_not_authorized"
  | "agent_token_already_set"
  | "genesis_registration_pending"
  | "ar_index_pending"
  | "pipeline_disabled"
  | "unknown";
export function mapMetaplexLaunchError(err: unknown): {
  code: MetaplexLaunchErrorCode;
  message: string;
} {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (isGenesisValidationError(err) || isAgentValidationError(err)) {
    if (lower.includes("image") || lower.includes("irys")) {
      return {
        code: "invalid_image_host",
        message: "Upload a token image with the Upload image button before launching.",
      };
    }
    if (lower.includes("name") || lower.includes("symbol") || lower.includes("description")) {
      return { code: "invalid_field_length", message: raw };
    }
    return { code: "metaplex_api_validation", message: raw };
  }
  if (isGenesisApiNetworkError(err) || isAgentApiNetworkError(err)) {
    return {
      code: "metaplex_api_unreachable",
      message: "Metaplex API is unreachable. Try again in a moment.",
    };
  }
  if (isGenesisApiError(err) || isAgentApiError(err)) {
    if (lower.includes("already") && lower.includes("token")) {
      return {
        code: "agent_token_already_set",
        message: "This agent already has a permanently bound token.",
      };
    }
    return { code: "metaplex_api_server", message: raw };
  }
  if (lower.includes("insufficient") || lower.includes("not enough")) {
    return { code: "insufficient_sol", message: "Agent wallet has insufficient SOL for this launch." };
  }
  if (lower.includes("blockhash")) {
    return { code: "blockhash_expired", message: "Transaction expired. Retry the launch." };
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return { code: "rpc_timeout", message: "Solana RPC timed out. Try again." };
  }
  if (lower.includes("submission state is uncertain") && lower.includes("duplicate agent")) {
    return {
      code: "agent_submission_uncertain",
      message: "Agent mint submission is still being reconciled. Automatic reminting is disabled to prevent a duplicate agent; retry after the submitted asset is visible on-chain.",
    };
  }
  if (lower.includes("genesis launch") && lower.includes("submission state is uncertain")) {
    return {
      code: "genesis_submission_uncertain",
      message: "Genesis launch submission is still being reconciled. Automatic recreation is disabled to prevent a duplicate permanent token binding.",
    };
  }
  if (lower.includes("not authorized") || lower.includes("unauthorized")) {
    return { code: "wallet_not_authorized", message: "Connected wallet is not authorized for this agent." };
  }
  if (lower.includes("index") && lower.includes("pending")) {
    return {
      code: "ar_index_pending",
      message: "Launch succeeded. AgentRanking indexing is still finishing.",
    };
  }
  if (lower.includes("registration") && lower.includes("pending")) {
    return {
      code: "genesis_registration_pending",
      message: "Token is on-chain. Metaplex launch registration is still finishing.",
    };
  }
  if (lower.includes("image") && (lower.includes("irys") || lower.includes("gateway") || lower.includes("required"))) {
    return {
      code: "invalid_image_host",
      message: "Upload a token image with the Upload image button before launching.",
    };
  }
  return { code: "unknown", message: raw || "Metaplex launch failed." };
}