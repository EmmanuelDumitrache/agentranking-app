import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toPublicCredential, isAccountVerifiedStatus } from "@/lib/verification/account-verification-types";
import { credentialProofPath, credentialProofUrl } from "@/lib/verification/public-agent-credential";
import {
  buildPublicCredentialClaim,
  buildVerificationAnchorPayload,
  hashPublicCredentialClaim,
  hashVerificationAnchorPayload,
} from "@/lib/verification/sap-anchor-payload";
import {
  SOLANA_8004_ANCHOR_CHAIN_ID,
  SOLANA_8004_MAINNET_PROGRAM_ID,
  SOLANA_8004_MAINNET_ROOT_CONFIG_PDA,
  SOLANA_8004_MAINNET_REGISTRY_CONFIG_PDA,
} from "@/lib/solana-8004/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
};

type Params = { params: Promise<{ publicId: string }> };

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request, { params }: Params) {
  const { publicId } = await params;
  if (!publicId?.trim()) {
    return NextResponse.json(
      { error: "publicId is required" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const account = await prisma.appAccount.findFirst({
    where: { publicId: publicId.trim() },
    select: {
      id: true,
      publicId: true,
      verificationLevel: true,
      verificationStatus: true,
      verifiedAt: true,
      verificationExpiresAt: true,
    },
  });

  if (!account) {
    return NextResponse.json(
      { error: "Credential not found" },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  const isVerified = isAccountVerifiedStatus(
    account.verificationStatus,
    account.verificationExpiresAt,
  );

  const latestAttestation = await prisma.accountVerification.findFirst({
    where: { appAccountId: account.id, status: "VERIFIED" },
    orderBy: { createdAt: "desc" },
    select: { attestationUid: true, attestationChainId: true, verifiedAt: true },
  });

  const origin = new URL(request.url).origin;
  const credential = {
    ...toPublicCredential({
      publicId: account.publicId,
      level: account.verificationLevel,
      status: account.verificationStatus,
      verifiedAt: account.verifiedAt,
      expiresAt: account.verificationExpiresAt,
    }),
    proofPath: credentialProofPath(account.publicId),
    proofUrl: credentialProofUrl(account.publicId, origin),
  };

  const publicClaim =
    isVerified && account.verifiedAt
      ? buildPublicCredentialClaim({
          publicId: account.publicId,
          level: account.verificationLevel,
          status: account.verificationStatus,
          verifiedAt: account.verifiedAt,
        })
      : null;

  const anchorPayload =
    isVerified && account.verifiedAt
      ? buildVerificationAnchorPayload({
          publicId: account.publicId,
          level: account.verificationLevel,
          verifiedAt: account.verifiedAt,
          appAccountId: account.id,
        })
      : null;

  const anchorHash = anchorPayload ? hashVerificationAnchorPayload(anchorPayload).hex : null;

  let onChain: Record<string, unknown> | null = null;
  if (latestAttestation?.attestationUid) {
    try {
      onChain = JSON.parse(latestAttestation.attestationUid) as Record<string, unknown>;
    } catch {
      onChain = { tx: latestAttestation.attestationUid };
    }
  }

  return NextResponse.json(
    {
      credential,
      isVerified,
      claimHash: publicClaim ? hashPublicCredentialClaim(publicClaim).hex : null,
      anchor: {
        hash: anchorHash,
        chainId: latestAttestation?.attestationChainId ?? SOLANA_8004_ANCHOR_CHAIN_ID,
        registry: {
          programId: SOLANA_8004_MAINNET_PROGRAM_ID,
          rootConfigPda: SOLANA_8004_MAINNET_ROOT_CONFIG_PDA,
          registryConfigPda: SOLANA_8004_MAINNET_REGISTRY_CONFIG_PDA,
        },
        attestation: onChain,
      },
    },
    { headers: CORS_HEADERS },
  );
}
