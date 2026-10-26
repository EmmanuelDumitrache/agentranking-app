import { prisma } from "@/lib/db";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { normalizeAgentService } from "@/lib/agent-service-normalization";
export type OnchainAgentIntelligence = {
  version: string;
  protocol: "evm-erc8004" | "solana-agent" | "solana-sap" | "hybrid" | "declared" | "unknown";
  protocols: string[];
  evidenceLevel: "chain-verified" | "chain-observed" | "document-observed" | "application-declared" | "none";
  identity: Record<string, unknown> | null;
  registration: Record<string, unknown> | null;
  metadata: Array<Record<string, unknown>>;
  services: Array<Record<string, unknown>>;
  reputation: Record<string, unknown>;
  validation: Record<string, unknown>;
  history: Record<string, unknown>;
  solana: Record<string, unknown> | null;
  sap: Record<string, unknown> | null;
  metaplex: Record<string, unknown> | null;
  evidence: Record<string, unknown>;
};
function portable(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString(10);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return { byteLength: value.byteLength };
  if (Array.isArray(value)) return value.map(portable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, portable(item)]));
  return value;
}
function compactMetadata(row: Record<string, unknown>): Record<string, unknown> {
  return {
    key: row.metadataKey,
    semanticType: row.semanticType,
    decodedType: row.decodedType,
    value: row.decodedJson ?? row.decodedUri ?? row.decodedAddress ?? row.decodedBoolean ?? row.decodedInteger ?? row.decodedText ?? row.hexValue,
    address: row.decodedAddress,
    uri: row.decodedUri,
    bytes32: row.decodedBytes32,
    blockNumber: row.blockNumber,
    transactionHash: row.transactionHash,
    operationContext: row.operationContext,
    blockHash: row.blockHash,
    decoderVersion: row.decoderVersion,
    normalizationEvidence: row.normalizationEvidence,
  };
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
function serviceSourceFallback(listingRegistrySource: string | null | undefined): string {
  const source = listingRegistrySource?.trim() ?? "";
  return !source || source === "default" ? "application" : source;
}
function normalizedStoredServices(agent: Parameters<typeof loadOnchainAgentIntelligence>[0]): Array<Record<string, unknown>> {
  return (agent.services ?? []).map((service) => {
    const sourceName = service.sourceName?.trim() || service.name;
    const sourceEndpoint = service.sourceEndpoint?.trim() || service.endpoint;
    const sourceVersion = service.sourceVersion?.trim() || service.version;
    const normalized = normalizeAgentService({
      name: sourceName,
      endpoint: sourceEndpoint,
      version: sourceVersion,
      skills: stringArray(service.skills),
      domains: stringArray(service.domains),
      capabilities: stringArray(service.capabilities),
      extensions: record(service.extensions),
    });
    return {
      name: sourceName,
      endpoint: normalized.normalizedEndpoint ?? sourceEndpoint,
      version: sourceVersion,
      sourceName,
      normalizedType: service.normalizedType ?? normalized.normalizedType,
      sourceEndpoint,
      normalizedEndpoint: normalized.normalizedEndpoint,
      endpointKind: service.endpointKind ?? normalized.endpointKind,
      endpointValid: service.endpointValid ?? normalized.validationStatus === "valid",
      validationStatus: service.endpointValid == null ? normalized.validationStatus : service.endpointValid ? "valid" : "invalid",
      validationReason: normalized.validationReason,
      sourceVersion,
      sourceDigest: service.sourceDigest ?? null,
      sourceKind: service.sourceKind ?? serviceSourceFallback(agent.listingRegistrySource),
      evidenceSource: service.sourceKind ?? serviceSourceFallback(agent.listingRegistrySource),
      skills: normalized.skills,
      domains: normalized.domains,
      capabilities: normalized.capabilities,
      extensions: normalized.extensions,
    };
  });
}
function mergeServices(...groups: Array<Array<Record<string, unknown>>>): Array<Record<string, unknown>> {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const service of groups.flat()) {
    const key = [service.normalizedType ?? service.name, service.normalizedEndpoint ?? service.endpoint, service.version]
      .map((value) => String(value ?? "").toLocaleLowerCase("en-US"))
      .join("\0");
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, service);
      continue;
    }
    const sources = new Set([
      ...stringArray(current.evidenceSources),
      String(current.evidenceSource ?? ""),
      ...stringArray(service.evidenceSources),
      String(service.evidenceSource ?? ""),
    ].filter(Boolean));
    byKey.set(key, {
      ...current,
      ...service,
      skills: [...new Set([...stringArray(current.skills), ...stringArray(service.skills)])],
      domains: [...new Set([...stringArray(current.domains), ...stringArray(service.domains)])],
      capabilities: [...new Set([...stringArray(current.capabilities), ...stringArray(service.capabilities)])],
      evidenceSources: [...sources],
    });
  }
  return [...byKey.values()];
}
export async function loadOnchainAgentIntelligence(agent: {
  id: number;
  chainId: number;
  agentId: number;
  protocolAgentId?: string | null;
  agentURI?: string | null;
  listingRegistrySource?: string | null;
  services?: Array<{
    name: string;
    endpoint: string;
    version: string;
    sourceName?: string | null;
    normalizedType?: string | null;
    sourceEndpoint?: string | null;
    endpointKind?: string | null;
    endpointValid?: boolean | null;
    sourceVersion?: string | null;
    sourceDigest?: string | null;
    sourceKind?: string | null;
    skills?: unknown;
    domains?: unknown;
    capabilities?: unknown;
    extensions?: unknown;
  }>;
  sapVerified?: boolean | null;
  sapAgentPda?: string | null;
  sapStatsPda?: string | null;
  sapCapabilities?: unknown;
  sapPricingTiers?: unknown;
  sapProtocols?: string[] | null;
  sapX402Endpoint?: string | null;
  sapRegistrationTx?: string | null;
  sapLastSyncedAt?: Date | string | null;
  sapStats?: unknown;
  sapOwnerWallet?: string | null;
  sapRegisteredAt?: Date | string | null;
  metaplexVerified?: boolean | null;
  metaplexRawData?: unknown;
  metaplexAssetAddress?: string | null;
  metaplexAgentIdentityPda?: string | null;
  metaplexAgentRegistrationUri?: string | null;
  metaplexAssetSignerPda?: string | null;
  metaplexAgentTokenMint?: string | null;
  metaplexSupportedTrust?: string[] | null;
  metaplexLastIndexedAt?: Date | string | null;
  solanaAssetAddress?: string | null;
}): Promise<OnchainAgentIntelligence> {
  const protocolAgentId = agent.protocolAgentId?.trim() || String(agent.agentId);
  const solanaAsset = agent.solanaAssetAddress?.trim() || agent.metaplexAssetAddress?.trim() || null;
  const isSolana = agent.chainId === SOLANA_CHAIN_ID || Boolean(solanaAsset);
  const [
    identity,
    identityHistory,
    metadata,
    metadataHistory,
    metadataObservationCount,
    feedback,
    feedbackCount,
    validation,
    registration,
    solanaObservation,
    solanaHistory,
  ] = await Promise.all([
    prisma.evmIdentityObservation.findFirst({
      where: { chainId: agent.chainId, protocolAgentId, status: "finalized" },
      orderBy: [{ blockNumber: "desc" }, { transactionIndex: "desc" }, { lastLogIndex: "desc" }],
    }),
    prisma.evmIdentityObservation.findMany({
      where: { chainId: agent.chainId, protocolAgentId, status: "finalized" },
      orderBy: [{ blockNumber: "desc" }, { transactionIndex: "desc" }, { lastLogIndex: "desc" }],
      take: 25,
    }),
    prisma.evmIdentityMetadataObservation.findMany({
      where: { chainId: agent.chainId, protocolAgentId, status: "finalized", isCurrent: true },
      orderBy: [{ metadataKey: "asc" }],
      take: 256,
    }),
    prisma.evmIdentityMetadataObservation.findMany({
      where: { chainId: agent.chainId, protocolAgentId, status: "finalized" },
      orderBy: [{ blockNumber: "desc" }, { transactionIndex: "desc" }, { logIndex: "desc" }],
      take: 50,
    }),
    prisma.evmIdentityMetadataObservation.count({
      where: { chainId: agent.chainId, protocolAgentId, status: "finalized" },
    }),
    prisma.evmFeedbackObservation.findMany({
      where: { chainId: agent.chainId, protocolAgentId, status: "finalized" },
      orderBy: [{ blockNumber: "desc" }, { transactionIndex: "desc" }, { logIndex: "desc" }],
      take: 25,
    }),
    prisma.evmFeedbackObservation.count({ where: { chainId: agent.chainId, protocolAgentId, status: "finalized", eventType: "NewFeedback" } }),
    prisma.evmValidationObservation.findMany({
      where: { chainId: agent.chainId, protocolAgentId, status: "finalized" },
      orderBy: [{ blockNumber: "desc" }, { transactionIndex: "desc" }, { logIndex: "desc" }],
      take: 25,
    }),
    agent.agentURI
      ? prisma.registrationDocumentObservation.findFirst({ where: { OR: [{ normalizedUri: agent.agentURI }, { sourceUri: agent.agentURI }] }, orderBy: { fetchedAt: "desc" } })
      : Promise.resolve(null),
    isSolana && solanaAsset
      ? prisma.solanaAgentObservation.findFirst({
          where: { asset: solanaAsset, isCurrent: true },
          orderBy: [{ slot: "desc" }, { eventOrdinal: "desc" }],
        })
      : Promise.resolve(null),
    isSolana && solanaAsset
      ? prisma.solanaAgentObservation.findMany({
          where: { asset: solanaAsset },
          orderBy: [{ slot: "desc" }, { transactionIndex: "desc" }, { eventOrdinal: "desc" }],
          take: 25,
        })
      : Promise.resolve([]),
  ]);
  const validationResponses = validation.filter((row) => row.eventType === "ValidationResponse" && row.response != null);
  const successfulValidation = validationResponses.filter((row) => (row.response ?? 0) >= 100).length;
  const averageValidationResponse = validationResponses.length === 0
    ? null
    : validationResponses.reduce((sum, row) => sum + (row.response ?? 0), 0) / validationResponses.length;
  const feedbackDocuments = feedback.filter((row) => row.documentParsed != null).length;
  const validFeedbackDocuments = feedback.filter((row) => row.documentHashValid === true).length;
  const validValidationDocuments = validation.filter((row) => row.documentHashValid === true).length;
  const recentClients = new Set(feedback.map((row) => row.clientAddress.toLowerCase()));
  const recentTags = [...new Set(feedback.flatMap((row) => [row.tag1, row.tag2]).filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
  const recentEndpoints = [...new Set(feedback.map((row) => row.endpoint).filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
  const transactionSignatures = [...new Set(
    [solanaObservation?.transactionSignature, ...solanaHistory.map((row) => row.transactionSignature)]
      .filter((value): value is string => Boolean(value)),
  )];
  const transactions = transactionSignatures.length === 0
    ? []
    : await prisma.solanaTransactionObservation.findMany({
        where: { signature: { in: transactionSignatures } },
      });
  const transactionsBySignature = new Map(transactions.map((row) => [row.signature, row]));
  const transaction = (solanaObservation?.transactionSignature
    ? transactionsBySignature.get(solanaObservation.transactionSignature) ?? null
    : null) as Record<string, unknown> | null;
  const registrationCore = registration?.parsedCore && typeof registration.parsedCore === "object" && !Array.isArray(registration.parsedCore)
    ? registration.parsedCore as Record<string, unknown>
    : null;
  const decodedRegistrationServices = Array.isArray(registrationCore?.services)
    ? registrationCore.services.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value))
    : [];
  const registrationObject = registration == null ? null : {
    sourceUri: registration.sourceUri,
    normalizedUri: registration.normalizedUri,
    contentAddress: registration.sourceContentAddress,
    immutable: registration.immutable,
    rawDocumentDigest: registration.rawDocumentDigest,
    normalizedFingerprint: registration.normalizedFingerprint,
    schemaValidityStatus: registration.schemaValidityStatus,
    parsedCore: registration.parsedCore,
    extensions: registration.extensions,
    decoderVersion: registration.decoderVersion,
    fetchedAt: registration.fetchedAt,
  };
  const identityObject = identity == null ? null : {
    registryAddress: identity.registryAddress,
    registryGeneration: identity.registryGeneration,
    protocolAgentId: identity.protocolAgentId,
    registeredOwner: identity.registeredOwner,
    currentOwner: identity.currentOwner,
    agentWallet: identity.currentAgentWallet,
    agentUri: identity.agentUri,
    blockNumber: identity.blockNumber,
    blockHash: identity.blockHash,
    transactionHash: identity.transactionHash,
    blockTime: identity.blockTime,
    decoderVersion: identity.decoderVersion,
  };
  const recentFeedback = feedback.map((row) => ({
    eventType: row.eventType,
    clientAddress: row.clientAddress,
    feedbackIndex: row.feedbackIndex,
    exactValue: row.exactValue,
    valueDecimals: row.valueDecimals,
    tag1: row.tag1,
    tag2: row.tag2,
    endpoint: row.endpoint,
    feedbackUri: row.feedbackUri,
    feedbackHash: row.feedbackHash,
    hashValid: row.documentHashValid,
    document: row.documentNormalized ?? row.documentParsed,
    documentDiagnostics: row.documentDiagnostics,
    normalizationEvidence: row.normalizationEvidence,
    revoked: row.revoked,
    responder: row.responder,
    responderClassification: row.responderClassification,
    classificationEvidence: row.classificationEvidence,
    responseUri: row.responseUri,
    responseHash: row.responseHash,
    blockNumber: row.blockNumber,
    transactionHash: row.transactionHash,
  }));
  const recentValidation = validation.map((row) => ({
    eventType: row.eventType,
    validatorAddress: row.validatorAddress,
    requestHash: row.requestHash,
    requestUri: row.requestUri,
    response: row.response,
    responseUri: row.responseUri,
    responseHash: row.responseHash,
    tag: row.tag,
    hashValid: row.documentHashValid,
    document: row.documentNormalized ?? row.documentParsed,
    documentRole: row.documentRole,
    documentDiagnostics: row.documentDiagnostics,
    normalizationEvidence: row.normalizationEvidence,
    blockNumber: row.blockNumber,
    transactionHash: row.transactionHash,
  }));
  const identityTimeline = identityHistory.map((row) => ({
    registeredOwner: row.registeredOwner,
    currentOwner: row.currentOwner,
    agentWallet: row.currentAgentWallet,
    agentUri: row.agentUri,
    hydrationReason: row.hydrationReason,
    registeredAtEventPosition: row.registeredAtEventPosition,
    currentOwnerEventPosition: row.currentOwnerEventPosition,
    currentWalletEventPosition: row.currentWalletEventPosition,
    blockNumber: row.blockNumber,
    blockHash: row.blockHash,
    transactionHash: row.transactionHash,
    transactionIndex: row.transactionIndex,
    lastLogIndex: row.lastLogIndex,
    blockTime: row.blockTime,
    decoderVersion: row.decoderVersion,
  }));
  const metadataTimeline = metadataHistory.map((row) => compactMetadata(row as unknown as Record<string, unknown>));
  const solanaTimeline = solanaHistory.map((row) => {
    const observedTransaction = row.transactionSignature
      ? transactionsBySignature.get(row.transactionSignature) ?? null
      : null;
    return {
      canonicalStatus: row.canonicalStatus,
      owner: row.owner,
      creator: row.creator,
      operationalWallet: row.operationalWallet,
      agentUri: row.agentUri,
      sequenceId: row.sequenceId,
      slot: row.slot,
      transactionIndex: row.transactionIndex,
      eventOrdinal: row.eventOrdinal,
      transactionSignature: row.transactionSignature,
      blockHash: row.blockHash,
      parentSlot: row.parentSlot,
      blockTime: row.blockTime,
      officialRank: row.officialRank,
      atomTrustTier: row.atomTrustTier,
      materializationEligible: row.materializationEligible,
      sourceVersion: row.sourceVersion,
      transaction: observedTransaction == null ? null : {
        status: observedTransaction.status,
        transactionVersion: observedTransaction.transactionVersion,
        expectedProgramId: observedTransaction.expectedProgramId,
        expectedProgramExecuted: observedTransaction.expectedProgramExecuted,
        decodedInstructions: observedTransaction.decodedInstructions,
        executionError: observedTransaction.executionError,
        slot: observedTransaction.slot,
      },
    };
  });
  const registrationServices = decodedRegistrationServices.map((service) => ({
    ...service,
    sourceKind: "registration-document",
    evidenceSource: "registration-document",
    evidenceSources: ["registration-document"],
    documentObserved: true,
  }));
  const storedServices = normalizedStoredServices(agent);
  const services: Array<Record<string, unknown> & { chainAnchored: boolean }> = mergeServices(registrationServices, storedServices).map((service) => {
    const sourceKind = String(service.sourceKind ?? service.evidenceSource ?? "application");
    const chainAnchored = sourceKind === "sap"
      ? Boolean(agent.sapAgentPda || agent.sapRegistrationTx || agent.sapVerified)
      : sourceKind === "metaplex-registration"
        ? Boolean(agent.metaplexAssetAddress || agent.metaplexAgentIdentityPda || agent.metaplexVerified)
        : sourceKind === "registration" || sourceKind === "registration-document"
          ? Boolean(
              identity ||
              solanaObservation ||
              agent.sapAgentPda ||
              agent.sapRegistrationTx ||
              agent.sapVerified ||
              agent.metaplexAssetAddress ||
              agent.metaplexAgentIdentityPda ||
              agent.metaplexVerified
            )
          : false;
    return { ...service, chainAnchored };
  });
  const sap = agent.sapAgentPda || agent.sapRegistrationTx || agent.sapVerified
    ? {
        verified: Boolean(agent.sapVerified),
        agentPda: agent.sapAgentPda ?? null,
        statsPda: agent.sapStatsPda ?? null,
        ownerWallet: agent.sapOwnerWallet ?? null,
        registrationTransaction: agent.sapRegistrationTx ?? null,
        registeredAt: agent.sapRegisteredAt ?? null,
        lastSyncedAt: agent.sapLastSyncedAt ?? null,
        protocols: agent.sapProtocols ?? [],
        capabilities: agent.sapCapabilities ?? [],
        pricingTiers: agent.sapPricingTiers ?? [],
        x402Endpoint: agent.sapX402Endpoint ?? null,
        stats: agent.sapStats ?? null,
      }
    : null;
  const metaplexRaw = record(agent.metaplexRawData);
  const metaplex = agent.metaplexAssetAddress || agent.metaplexAgentIdentityPda || agent.metaplexVerified || metaplexRaw
    ? {
        verified: Boolean(agent.metaplexVerified),
        asset: agent.metaplexAssetAddress ?? null,
        agentIdentityPda: agent.metaplexAgentIdentityPda ?? null,
        registrationUri: agent.metaplexAgentRegistrationUri ?? null,
        assetSignerPda: agent.metaplexAssetSignerPda ?? null,
        agentTokenMint: agent.metaplexAgentTokenMint ?? null,
        supportedTrust: agent.metaplexSupportedTrust ?? [],
        lastIndexedAt: agent.metaplexLastIndexedAt ?? null,
        rawData: metaplexRaw,
      }
    : null;
  const hasEvmEvidence = Boolean(identity || metadataObservationCount > 0 || feedback.length > 0 || validation.length > 0);
  const hasSolanaIndexerEvidence = Boolean(solanaObservation || solanaHistory.length > 0 || agent.solanaAssetAddress);
  const hasSapEvidence = sap != null;
  const hasMetaplexEvidence = metaplex != null;
  const hasChainEvidence = hasEvmEvidence || hasSolanaIndexerEvidence || hasSapEvidence || hasMetaplexEvidence;
  const hasVerifiedChainEvidence = Boolean(
    identity ||
    agent.sapVerified ||
    agent.metaplexVerified ||
    transaction?.expectedProgramExecuted === true,
  );
  const protocols = [
    ...(hasEvmEvidence ? ["erc8004-evm"] : []),
    ...(hasSolanaIndexerEvidence ? ["solana-8004-direct-rpc"] : []),
    ...(hasMetaplexEvidence ? ["metaplex-agent-registry"] : []),
    ...(hasSapEvidence ? ["synapse-agent-protocol"] : []),
    ...(registration ? ["registration-document"] : []),
  ];
  const chainProtocolCount = Number(hasEvmEvidence) + Number(hasSolanaIndexerEvidence || hasMetaplexEvidence) + Number(hasSapEvidence);
  const protocol: OnchainAgentIntelligence["protocol"] = chainProtocolCount > 1
    ? "hybrid"
    : hasEvmEvidence
      ? "evm-erc8004"
      : hasSapEvidence
        ? "solana-sap"
        : hasSolanaIndexerEvidence || hasMetaplexEvidence
          ? "solana-agent"
          : registration || services.length > 0
            ? "declared"
            : "unknown";
  const evidenceLevel: OnchainAgentIntelligence["evidenceLevel"] = hasVerifiedChainEvidence
    ? "chain-verified"
    : hasChainEvidence
      ? "chain-observed"
      : registration
        ? "document-observed"
        : services.length > 0
          ? "application-declared"
          : "none";
  const result: OnchainAgentIntelligence = {
    version: "agent-onchain-intelligence/5",
    protocol,
    protocols,
    evidenceLevel,
    identity: identityObject,
    registration: registrationObject,
    metadata: metadata.map((row) => compactMetadata(row as unknown as Record<string, unknown>)),
    services,
    reputation: {
      observationCount: feedback.length,
      totalFeedbackCount: feedbackCount,
      decodedDocumentCount: feedbackDocuments,
      hashVerifiedDocumentCount: validFeedbackDocuments,
      recentUniqueClientCount: recentClients.size,
      recentTags,
      recentEndpoints,
      recent: recentFeedback,
    },
    validation: {
      observationCount: validation.length,
      responseCount: validationResponses.length,
      successfulResponseCount: successfulValidation,
      averageResponse: averageValidationResponse,
      uniqueValidatorCount: new Set(validationResponses.map((row) => row.validatorAddress.toLowerCase())).size,
      hashVerifiedDocumentCount: validValidationDocuments,
      recent: recentValidation,
    },
    history: {
      identity: identityTimeline,
      metadata: metadataTimeline,
      solana: solanaTimeline,
    },
    solana: solanaObservation == null ? null : {
      asset: solanaObservation.asset,
      sequenceId: solanaObservation.sequenceId,
      owner: solanaObservation.owner,
      creator: solanaObservation.creator,
      operationalWallet: solanaObservation.operationalWallet,
      agentUri: solanaObservation.agentUri,
      canonicalStatus: solanaObservation.canonicalStatus,
      commitment: solanaObservation.commitment,
      slot: solanaObservation.slot,
      transactionSignature: solanaObservation.transactionSignature,
      officialRank: solanaObservation.officialRank,
      atomTrustTier: solanaObservation.atomTrustTier,
      rawData: solanaObservation.rawData,
      transaction: transaction == null ? null : {
        status: transaction.status,
        transactionVersion: transaction.transactionVersion,
        expectedProgramId: transaction.expectedProgramId,
        expectedProgramExecuted: transaction.expectedProgramExecuted,
        decodedInstructions: transaction.decodedInstructions,
        slot: transaction.slot,
        genesisHash: transaction.genesisHash,
      },
    },
    sap,
    metaplex,
    evidence: {
      level: evidenceLevel,
      hasChainEvidence,
      hasVerifiedChainEvidence,
      hasDocumentEvidence: Boolean(registration),
      hasDeclaredServiceEvidence: services.length > 0,
      listingRegistrySource: agent.listingRegistrySource ?? null,
      identityObservation: Boolean(identity),
      identityObservationCount: identityHistory.length,
      metadataObservationCount,
      currentMetadataObservationCount: metadata.length,
      typedMetadataObservationCount: metadata.filter((row) => row.semanticType != null).length,
      currentMetadataDecoderVersions: [...new Set(metadata.map((row) => row.decoderVersion))],
      feedbackDecoderVersions: [...new Set(feedback.map((row) => row.decoderVersion))],
      validationDecoderVersions: [...new Set(validation.map((row) => row.decoderVersion))],
      registrationDocumentObserved: Boolean(registration),
      registrationSchemaStatus: registration?.schemaValidityStatus ?? null,
      declaredServiceCount: services.length,
      chainAnchoredServiceCount: services.filter((service) => service.chainAnchored === true).length,
      serviceSourceKinds: [...new Set(services.map((service) => String(service.sourceKind ?? service.evidenceSource ?? "application")))],
      solanaObservation: Boolean(solanaObservation),
      solanaObservationCount: solanaHistory.length,
      solanaTransactionEvidenceCount: transactions.length,
      sapObservation: hasSapEvidence,
      metaplexObservation: hasMetaplexEvidence,
      generatedAt: new Date().toISOString(),
    },
  };
  return portable(result) as OnchainAgentIntelligence;
}
