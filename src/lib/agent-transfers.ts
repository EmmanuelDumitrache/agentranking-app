import { prisma } from "@/lib/db";
export type TransferEntry = {
  id: string;
  token: string;
  fromPublicKey: string;
  toPublicKey: string;
  amountLamports: string;
  signature: string | null;
  status: string;
  createdAt: string;
  confirmedAt: string | null;
};
export async function getRecentTransfers(
  agentDbId: number,
  limit = 10,
): Promise<TransferEntry[]> {
  const transfers = await prisma.custodialWalletTransfer.findMany({
    where: { agentDbId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      token: true,
      fromPublicKey: true,
      toPublicKey: true,
      amountLamports: true,
      signature: true,
      status: true,
      createdAt: true,
      confirmedAt: true,
    },
  });
  return transfers.map((t) => ({
    ...t,
    amountLamports: t.amountLamports.toString(),
    createdAt: t.createdAt.toISOString(),
    confirmedAt: t.confirmedAt?.toISOString() ?? null,
  }));
}