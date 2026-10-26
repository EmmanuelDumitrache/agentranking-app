import type { VerifiedAgentRow } from "@/components/verified/types";

export const VERIFIED_DIRECTORY_PAGE_SIZE = 25;

export type VerifiedDirectoryPageData = {
  agents: VerifiedAgentRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  generatedAt: string;
};

export function verifiedDirectoryQueryKey(perPage = VERIFIED_DIRECTORY_PAGE_SIZE) {
  return ["verified-agents", perPage] as const;
}
