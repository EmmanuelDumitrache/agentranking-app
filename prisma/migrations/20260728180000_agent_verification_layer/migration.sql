-- AgentRanking Verification Layer (KYA)
-- No PII columns. Partner names never appear in schema.

CREATE TYPE "PassportStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED');
CREATE TYPE "RiskTier" AS ENUM ('UNRATED', 'BASIC', 'STANDARD', 'ELEVATED', 'PRIVILEGED');

CREATE TABLE "AgentPassport" (
    "id" TEXT NOT NULL,
    "ownerWallet" TEXT NOT NULL,
    "ownerWalletChain" TEXT NOT NULL,
    "agentId" INTEGER NOT NULL,
    "status" "PassportStatus" NOT NULL DEFAULT 'PENDING',
    "riskTier" "RiskTier" NOT NULL DEFAULT 'UNRATED',
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "lastScreenedAt" TIMESTAMP(3),
    "passportHash" TEXT NOT NULL,
    "anchorTx" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPassport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OwnershipChallenge" (
    "id" TEXT NOT NULL,
    "agentId" INTEGER NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'ownership',
    "nonce" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnershipChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OwnershipProof" (
    "id" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnershipProof_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentDelegation" (
    "id" TEXT NOT NULL,
    "parentPassportId" TEXT NOT NULL,
    "delegatedAgentId" INTEGER NOT NULL,
    "delegatedWallet" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "scopes" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AgentDelegation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RiskAssessment" (
    "id" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "tier" "RiskTier" NOT NULL,
    "factors" JSONB NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assessorVersion" TEXT NOT NULL,

    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VerificationEvent" (
    "id" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentPassport_passportHash_key" ON "AgentPassport"("passportHash");
CREATE INDEX "AgentPassport_ownerWallet_idx" ON "AgentPassport"("ownerWallet");
CREATE INDEX "AgentPassport_agentId_idx" ON "AgentPassport"("agentId");
CREATE INDEX "AgentPassport_status_idx" ON "AgentPassport"("status");
CREATE INDEX "AgentPassport_riskTier_idx" ON "AgentPassport"("riskTier");
CREATE INDEX "AgentPassport_status_lastScreenedAt_idx" ON "AgentPassport"("status", "lastScreenedAt");

CREATE UNIQUE INDEX "OwnershipChallenge_nonce_key" ON "OwnershipChallenge"("nonce");
CREATE INDEX "OwnershipChallenge_walletAddress_idx" ON "OwnershipChallenge"("walletAddress");
CREATE INDEX "OwnershipChallenge_expiresAt_idx" ON "OwnershipChallenge"("expiresAt");

CREATE UNIQUE INDEX "OwnershipProof_nonce_key" ON "OwnershipProof"("nonce");
CREATE INDEX "OwnershipProof_passportId_idx" ON "OwnershipProof"("passportId");
CREATE INDEX "OwnershipProof_walletAddress_idx" ON "OwnershipProof"("walletAddress");

CREATE INDEX "AgentDelegation_parentPassportId_idx" ON "AgentDelegation"("parentPassportId");
CREATE INDEX "AgentDelegation_delegatedAgentId_idx" ON "AgentDelegation"("delegatedAgentId");
CREATE INDEX "AgentDelegation_delegatedWallet_idx" ON "AgentDelegation"("delegatedWallet");
CREATE INDEX "AgentDelegation_active_idx" ON "AgentDelegation"("active");

CREATE INDEX "RiskAssessment_passportId_assessedAt_idx" ON "RiskAssessment"("passportId", "assessedAt");

CREATE INDEX "VerificationEvent_passportId_createdAt_idx" ON "VerificationEvent"("passportId", "createdAt");
CREATE INDEX "VerificationEvent_eventType_idx" ON "VerificationEvent"("eventType");

ALTER TABLE "AgentPassport" ADD CONSTRAINT "AgentPassport_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OwnershipProof" ADD CONSTRAINT "OwnershipProof_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "AgentPassport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentDelegation" ADD CONSTRAINT "AgentDelegation_parentPassportId_fkey" FOREIGN KEY ("parentPassportId") REFERENCES "AgentPassport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentDelegation" ADD CONSTRAINT "AgentDelegation_delegatedAgentId_fkey" FOREIGN KEY ("delegatedAgentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "AgentPassport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VerificationEvent" ADD CONSTRAINT "VerificationEvent_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "AgentPassport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
