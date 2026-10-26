import "server-only";
import { prisma } from "@/lib/db";
import { getRecentTransfers } from "@/lib/agent-transfers";
import type { TerminalLogLineDto } from "@/lib/agent-trading/terminal-log-shared";

function shortAddress(value: string | null | undefined, chars = 4): string {
  const trimmed = value?.trim();
  if (!trimmed) return "—";
  if (trimmed.length <= chars * 2 + 1) return trimmed;
  return `${trimmed.slice(0, chars)}…${trimmed.slice(-chars)}`;
}

function tradeLine(trade: {
  id: string;
  side: string;
  status: string;
  tokenSymbol: string | null;
  inputAmount: string;
  outputAmount: string;
  signature: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
}): TerminalLogLineDto {
  const symbol = trade.tokenSymbol ?? "TOKEN";
  const at = (trade.confirmedAt ?? trade.createdAt).toISOString();
  const sig = trade.signature ? ` tx=${shortAddress(trade.signature, 6)}` : "";
  return {
    id: `trade:${trade.id}`,
    at,
    channel: "trade",
    text: `${trade.side.toUpperCase()} ${symbol} ${trade.status} in=${trade.inputAmount} out=${trade.outputAmount}${sig}`,
  };
}

function copyConfigLines(config: {
  id: string;
  label: string | null;
  targetWallet: string;
  venue: string;
  status: string;
  mirrorCount: number;
  createdAt: Date;
  updatedAt: Date;
  lastMirroredAt: Date | null;
  lastMirroredSig: string | null;
}): TerminalLogLineDto[] {
  const label = config.label?.trim() || shortAddress(config.targetWallet, 6);
  const lines: TerminalLogLineDto[] = [
    {
      id: `copy:cfg:${config.id}:created`,
      at: config.createdAt.toISOString(),
      channel: "copy",
      text: `subscribed ${label} venue=${config.venue} status=${config.status}`,
    },
  ];
  if (config.lastMirroredAt) {
    lines.push({
      id: `copy:mirror:${config.id}:${config.lastMirroredAt.toISOString()}`,
      at: config.lastMirroredAt.toISOString(),
      channel: "copy",
      text: `mirrored #${config.mirrorCount} from ${shortAddress(config.targetWallet)}${config.lastMirroredSig ? ` tx=${shortAddress(config.lastMirroredSig, 6)}` : ""}`,
    });
  }
  if (config.updatedAt.getTime() !== config.createdAt.getTime()) {
    lines.push({
      id: `copy:cfg:${config.id}:updated:${config.updatedAt.toISOString()}`,
      at: config.updatedAt.toISOString(),
      channel: "copy",
      text: `config updated ${label} status=${config.status} mirrors=${config.mirrorCount}`,
    });
  }
  return lines;
}

function scheduleRunLine(run: {
  id: string;
  status: string;
  outputSummary: string | null;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  schedule: { label: string; type: string };
}): TerminalLogLineDto {
  const at = (run.completedAt ?? run.startedAt ?? run.createdAt).toISOString();
  const summary =
    run.outputSummary?.trim() || run.errorMessage?.trim() || run.status;
  return {
    id: `schedule:${run.id}`,
    at,
    channel: "schedule",
    text: `${run.schedule.label} (${run.schedule.type}) ${run.status} — ${summary}`,
  };
}

function transferLine(transfer: {
  id: string;
  token: string;
  toPublicKey: string;
  amountLamports: string;
  status: string;
  signature: string | null;
  createdAt: string;
  confirmedAt: string | null;
}): TerminalLogLineDto {
  const sol =
    transfer.token === "SOL"
      ? (Number(transfer.amountLamports) / 1_000_000_000).toFixed(6)
      : transfer.amountLamports;
  const at = transfer.confirmedAt ?? transfer.createdAt;
  return {
    id: `wallet:${transfer.id}`,
    at,
    channel: "wallet",
    text: `send ${sol} ${transfer.token} → ${shortAddress(transfer.toPublicKey)} ${transfer.status}${transfer.signature ? ` tx=${shortAddress(transfer.signature, 6)}` : ""}`,
  };
}

export async function loadAgentTerminalActivityLog(
  agentDbId: number,
  limit = 120,
): Promise<TerminalLogLineDto[]> {
  const [trades, copyConfigs, scheduleRuns, transfers] = await Promise.all([
    prisma.agentTrade.findMany({
      where: { agentDbId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 50),
      select: {
        id: true,
        side: true,
        status: true,
        tokenSymbol: true,
        inputAmount: true,
        outputAmount: true,
        signature: true,
        createdAt: true,
        confirmedAt: true,
      },
    }),
    prisma.agentCopyTradeConfig.findMany({
      where: { agentDbId },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        label: true,
        targetWallet: true,
        venue: true,
        status: true,
        mirrorCount: true,
        createdAt: true,
        updatedAt: true,
        lastMirroredAt: true,
        lastMirroredSig: true,
      },
    }),
    prisma.agentScheduleRun.findMany({
      where: { schedule: { agentDbId } },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        status: true,
        outputSummary: true,
        errorMessage: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        schedule: { select: { label: true, type: true } },
      },
    }),
    getRecentTransfers(agentDbId, 30),
  ]);

  const lines: TerminalLogLineDto[] = [
    ...trades.map(tradeLine),
    ...copyConfigs.flatMap(copyConfigLines),
    ...scheduleRuns.map(scheduleRunLine),
    ...transfers.map(transferLine),
  ];

  lines.sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
  return lines.slice(0, limit);
}
