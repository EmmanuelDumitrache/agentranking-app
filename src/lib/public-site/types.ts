import type { PublicAgentCredential } from "@/lib/verification/public-agent-credential";

export type PublicAgentPreview = {
  readonly id: number;
  readonly name: string;
  readonly image: string;
  readonly description: string;
  readonly publicVerificationStatus: string;
  readonly arVerificationStatus: string | null;
  readonly ownerAccountVerified?: boolean;
  readonly credential?: PublicAgentCredential;
  readonly isVerified: boolean;
  readonly tokenized: boolean;
  readonly profileHref: string;
  readonly linkedTokenLabel: string | null;
  readonly linkedTokenHref: string | null;
  readonly linkedTokenVenue: "PumpSwap" | "Metaplex" | "Robinhood" | null;
  readonly agentRankScore: number | null;
  readonly lastActiveAt: string | null;
  readonly listedAt: string | null;
  readonly socials: {
    readonly twitter: string | null;
    readonly telegram: string | null;
    readonly website: string | null;
  };
};