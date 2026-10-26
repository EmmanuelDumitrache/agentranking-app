export type PublicNetworkSummary = {
  id: number;
  chainId: number;
  name: string;
  shortName: string;
  icon: string;
  color: string;
  identityRegistry: string;
  reputationRegistry: string;
  agentCount: number;
  feedbackCount: number;
  isActive: boolean;
  isSyncable: boolean;
};
