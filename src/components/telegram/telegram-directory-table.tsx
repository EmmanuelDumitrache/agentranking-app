"use client";
import Link from "next/link";
import { ExternalLink, Send, BadgeCheck } from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { cn, getScoreColor, timeAgo } from "@/lib/utils";
import {
  parseTelegramAgentMeta,
  telegramBotProfileUrl,
} from "@/lib/telegram/agent-meta";
import { TELEGRAM_BLUE } from "@/lib/telegram/constants";
import type { TelegramDirectoryAgentDto as TelegramDirectoryAgent } from "@/lib/agent-directory/telegram-directory";
function TelegramIcon({ className }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L8.17 13.404l-2.97-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.007.13.988.155z" />
    </svg>
  );
}
function TypeBadge({ isManaged }: { readonly isManaged: boolean }) {
  return (
    <span
      className={cn(
        "telegram-directory-type",
        isManaged && "telegram-directory-type--managed",
      )}
    >
      {isManaged ? "Managed" : "Standalone"}
    </span>
  );
}
export function TelegramDirectoryTable({
  agents,
  isLoading,
  isError,
  errorMessage,
}: {
  readonly agents: TelegramDirectoryAgent[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly errorMessage?: string;
}) {
  return (
    <div className="telegram-directory-table-wrap">
      <table className="telegram-directory-table">
        <thead>
          <tr>
            <th className="telegram-directory-th telegram-directory-th--bot">Bot</th>
            <th className="telegram-directory-th telegram-directory-th--type">Type</th>
            <th className="telegram-directory-th telegram-directory-th--score">Score</th>
            <th className="telegram-directory-th telegram-directory-th--added">Added</th>
            <th className="telegram-directory-th telegram-directory-th--actions" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <tr key={`sk-${i}`} className="telegram-directory-row telegram-directory-row--skeleton">
                  <td colSpan={5}>
                    <div className="telegram-directory-skeleton" />
                  </td>
                </tr>
              ))
            : isError ? (
                <tr>
                  <td colSpan={5} className="telegram-directory-empty telegram-directory-empty--error">
                    Failed to load bots.{errorMessage ? ` ${errorMessage}` : ""}
                  </td>
                </tr>
              ) : agents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="telegram-directory-empty">
                    No Telegram bots match these filters.
                  </td>
                </tr>
              ) : (
                agents.map((agent) => {
                  const meta = parseTelegramAgentMeta(agent.metadata, agent.image);
                  const detailHref = agent.profilePath;
                  const tgUrl = telegramBotProfileUrl(meta.botUsername, agent.name);
                  return (
                    <tr key={`${agent.chainId}-${agent.agentId}`} className="telegram-directory-row">
                      <td className="telegram-directory-td telegram-directory-td--bot">
                        <div className="telegram-directory-bot">
                          <div className="telegram-directory-avatar-wrap">
                            <AgentAvatar
                              image={meta.avatarUrl ?? agent.image ?? null}
                              name={agent.name}
                              size="sm"
                              className="rounded-lg"
                            />
                            <span className="telegram-directory-avatar-badge" aria-hidden>
                              <TelegramIcon className="h-2.5 w-2.5 text-white" />
                            </span>
                          </div>
                          <div className="min-w-0">
                            <Link href={detailHref} className="telegram-directory-bot-name">
                              {agent.name}
                              {(agent.isVerified || agent.isPremiumVerified) && (
                                <BadgeCheck className="inline h-3 w-3 shrink-0 text-amber-400" aria-hidden />
                              )}
                            </Link>
                            {meta.botUsername ? (
                              <a
                                href={tgUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="telegram-directory-username"
                                onClick={(e) => e.stopPropagation()}
                              >
                                @{meta.botUsername}
                              </a>
                            ) : null}
                            {meta.managerBot ? (
                              <p className="telegram-directory-manager">
                                via @{meta.managerBot}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="telegram-directory-td telegram-directory-td--type">
                        <TypeBadge isManaged={meta.isManaged} />
                      </td>
                      <td className="telegram-directory-td telegram-directory-td--score">
                        <span className={cn("telegram-directory-score", getScoreColor(agent.score))}>
                          {Math.round(agent.score)}
                        </span>
                      </td>
                      <td className="telegram-directory-td telegram-directory-td--added">
                        <span className="telegram-directory-added">{timeAgo(agent.createdAt)}</span>
                      </td>
                      <td className="telegram-directory-td telegram-directory-td--actions">
                        <div className="telegram-directory-actions">
                          {meta.spawnUrl ? (
                            <a
                              href={meta.spawnUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="telegram-directory-action telegram-directory-action--primary"
                              style={{ background: TELEGRAM_BLUE }}
                            >
                              <Send className="h-3 w-3" />
                              Spawn
                            </a>
                          ) : (
                            <a
                              href={tgUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="telegram-directory-action"
                            >
                              <TelegramIcon className="h-3 w-3" />
                              Open
                            </a>
                          )}
                          <Link href={detailHref} className="telegram-directory-action telegram-directory-action--ghost">
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
        </tbody>
      </table>
    </div>
  );
}
