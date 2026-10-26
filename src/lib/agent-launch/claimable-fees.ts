export type AgentLaunchClaimableFeesDto = {
  readonly ok: true;
  readonly launchId: string;
  readonly mint: string | null;
  readonly network: string;
  readonly feeSharingStatus: string;
  readonly canDistribute: boolean;
  readonly reason?: string;
  /** Total fee pool accrued on Pump.fun (pre 70/30 split). */
  readonly claimableSol: number | null;
  /** Creator share of the accrued pool (not yet distributed). */
  readonly accruedCreatorSol: number | null;
  /** Creator fees already distributed on-chain. */
  readonly distributedCreatorSol: number | null;
  /** Accrued creator share + distributed creator fees. */
  readonly earnedCreatorSol: number | null;
  readonly totalDistributedSol: number | null;
  readonly agentShareBps: number;
  readonly arShareBps: number;
  readonly agentWallet: string | null;
  readonly feeRecipientWallet: string | null;
  readonly lastDistributionTx: string | null;
};
