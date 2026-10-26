export type AdminAccountDto = {
  id: number;
  email: string | null;
  walletAddress: string | null;
  displayName: string | null;
  username: string | null;
  subscriptionStatus: string;
  subscriptionPlan: string;
  subscriptionExpiresAt: string | null;
  subscriptionStartedAt: string | null;
  isClaimed: boolean;
  claimedAt: string | null;
  claimToken: null;
  hasClaimToken: boolean;
  claimTokenExpiresAt: string | null;
  adminNotes: string;
  createdAt: string;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  totpEnabledAt: string | null;
  emailOtpMfaEnabledAt: string | null;
};

export type AdminAccountsResponse = {
  accounts: AdminAccountDto[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};

export type AdminAccountAgentDto = {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  isVerified: boolean;
  isPremiumVerified: boolean;
  isVerifiedRevenue: boolean;
  slug: string;
  profilePath: string;
  profileUrl: string;
  dashboardPath: string;
};

export type AdminAccountAgentsResponse = {
  email: string | null;
  wallet: string | null;
  ownedAgents: AdminAccountAgentDto[];
  paidOrders: Array<{
    id: string;
    orderNumber: string;
    productType: string;
    paidAt: string | null;
  }>;
};

export type AdminUserProfileRow = {
  id: number;
  walletAddress: string | null;
  username: string | null;
  displayName: string | null;
  bio: string;
  followersCount: number;
  followingCount: number;
  createdAt: string;
  agentsCount: number;
  feedbackCount: number;
};

export type AdminUsersResponse = {
  profiles: AdminUserProfileRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};

export type AdminDashboardAgentRow = {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  owner: string;
  verifiedWallet: string;
  isVerified: boolean;
  isPremiumVerified: boolean;
  isVerifiedRevenue: boolean;
  slug: string;
  profilePath: string;
  profileUrl: string;
  dashboardPath: string;
};

export type AdminPaidLinkedAgentRow = AdminDashboardAgentRow & {
  sources: string[];
  isOwned: boolean;
};

export type AdminUserAgentsResponse = {
  wallet: string;
  ownedAgents: AdminDashboardAgentRow[];
  dashboardAgents: AdminDashboardAgentRow[];
  paidOrLinked: AdminPaidLinkedAgentRow[];
  unlinkedPaidOrders: Array<{
    id: string;
    orderNumber: string;
    productType: string;
    paidAt: string | null;
  }>;
};

export type AdminEmailAgentsResponse = {
  email: string | null;
  wallet: string | null;
  dashboardAgents: AdminDashboardAgentRow[];
  ownedAgents: AdminDashboardAgentRow[];
};

export type AdminCreatorListItemDto = {
  id: string;
  userProfileId: number;
  email: string | null;
  displayName: string | null;
  imageUrl: string | null;
  authProviders: string[];
  accountWalletPublicKey: string | null;
  platformCredits: number;
  llmCredits: number;
  maxAgents: number;
  agentCount: number;
  tokenizedCount: number;
  lastLoginAt: string | null;
  createdAt: string;
};

export type AdminCreatorsResponse = {
  creators: AdminCreatorListItemDto[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};

export type AdminCreatorDetailDto = AdminCreatorListItemDto & {
  adminNotes: string;
  onboardingCompletedAt: string | null;
  agents: Array<{
    id: number;
    agentId: number;
    chainId: number;
    name: string;
    description: string;
    image: string;
    isActive: boolean;
    publicVerificationStatus: string;
    listingRegistrySource: string;
    hasToken: boolean;
    tokenMint: string | null;
    tokenSymbol: string | null;
    publicHref: string;
    createdAt: string;
  }>;
  launches: Array<{
    id: string;
    agentDbId: number | null;
    agentName: string | null;
    mint: string | null;
    tokenName: string | null;
    tokenSymbol: string | null;
    tokenImageUrl: string | null;
    network: string;
    launchStatus: string;
    launchKind: string;
    arTokenVerificationStatus: string;
    createdAt: string;
    publicTokenHref: string | null;
  }>;
};

export type AdminInquiryReplyDto = {
  id: number;
  body: string;
  createdAt: string;
  authorRole: string;
  readByAdmin: boolean;
  readByUser: boolean;
};

export type AdminContactInquiryDto = {
  id: number;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: string;
  userId: number | null;
  createdAt: string;
  replies: AdminInquiryReplyDto[];
};

export type AdminContactResponse = {
  inquiries: AdminContactInquiryDto[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};

export type AdminVerificationRequestRow = {
  id: string;
  agentId: number;
  agentName: string;
  xHandle: string;
  walletAddress: string;
  website: string;
  tokenAddress: string;
  proofNotes: string;
  paymentStatus: string;
  verificationStatus: string;
  submittedAt: string;
  reviewedAt: string | null;
  reviewerNote: string;
  reviewedByAdmin: string | null;
  onChainAgentId: number;
  chainId: number;
  agentIsVerified: boolean;
  agentIsPremiumVerified: boolean;
  publicVerificationStatus: string;
  profilePath: string;
};

export type AdminVerificationRequestsResponse = {
  error?: string;
  requests: AdminVerificationRequestRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};
