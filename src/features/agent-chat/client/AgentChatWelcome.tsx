"use client";
import { memo } from "react";
import Image from "next/image";
import { Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getAgentChatStarterPrompts } from "../shared/welcome-prompts";
interface Props {
  agentName: string;
  agentImage?: string | null;
  isVerified?: boolean;
  greeting?: string | null;
  disabled?: boolean;
  onSelectPrompt: (text: string) => void;
  className?: string;
}
function AgentChatWelcomeComponent({
  agentName,
  agentImage,
  isVerified = false,
  greeting,
  disabled = false,
  onSelectPrompt,
  className,
}: Props) {
  const name = agentName.trim() || "Agent";
  const prompts = getAgentChatStarterPrompts(name);
  const headline =
    greeting?.trim() ||
    (disabled
      ? `${name} chat is currently unavailable.`
      : `${name} is online and ready on AgentRanking.`);
  return (
    <div
      className={cn(
        "ui-chat-welcome flex min-h-[45dvh] flex-col items-center justify-center px-4 py-10 text-center",
        className,
      )}
    >
      <div className="relative mb-4">
        {agentImage ? (
          <Image
            src={agentImage}
            alt=""
            width={72}
            height={72}
            unoptimized
            className="size-[4.5rem] rounded-full border border-[#212121] object-cover shadow-sm"
          />
        ) : (
          <div className="flex size-[4.5rem] items-center justify-center rounded-full border border-[#212121] bg-[#181818]">
            <Bot aria-hidden className="size-8 text-neutral-500" />
          </div>
        )}
        <span
          className={cn(
            "absolute bottom-1 right-1 size-3 rounded-full border-2 border-[#0f0f0f]",
            disabled ? "bg-neutral-700" : "bg-neutral-400",
          )}
          title={disabled ? "Unavailable" : "Available"}
          aria-hidden
        />
      </div>
      <div className="mb-1 flex items-center justify-center gap-2">
        <h2 className="text-lg font-medium tracking-tight sm:text-xl">
          {name}
        </h2>
        {isVerified ? (
          <Badge
            variant="secondary"
            className="border border-[#212121] bg-[#181818] px-1.5 py-0 text-[10px] text-neutral-300"
          >
            Verified
          </Badge>
        ) : null}
      </div>
      <p className="max-w-md text-sm leading-relaxed text-neutral-400">
        {headline}
      </p>
      <p className="mt-1 max-w-md text-sm text-neutral-500">
        {disabled
          ? "Starter prompts will be available when chat is ready."
          : "Here are a few things to try:"}
      </p>
      <div className="mt-6 flex w-full max-w-xl flex-col gap-2.5 sm:gap-3">
        {prompts.map((prompt) => (
          <button
            key={prompt.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelectPrompt(prompt.label)}
            className={cn(
              "ui-chat-welcome-prompt rounded-2xl border border-[#212121] bg-[#181818] px-4 py-3 text-left text-sm leading-snug text-neutral-200 sm:px-5 sm:py-3.5 sm:text-[15px]",
              "hover:border-neutral-700 hover:bg-[#212121]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {prompt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
export const AgentChatWelcome = memo(AgentChatWelcomeComponent);
