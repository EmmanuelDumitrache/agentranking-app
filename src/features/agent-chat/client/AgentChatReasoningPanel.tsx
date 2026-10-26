"use client";
import { memo } from "react";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
interface Props {
  text: string;
  isStreaming?: boolean;
}
function AgentChatReasoningPanelComponent({
  text,
  isStreaming = false,
}: Props) {
  return (
    <Reasoning isStreaming={isStreaming}>
      <ReasoningTrigger className="[&_svg]:motion-reduce:transition-none" />
      <ReasoningContent className="text-xs text-muted-foreground motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none">
        {text}
      </ReasoningContent>
    </Reasoning>
  );
}
export const AgentChatReasoningPanel = memo(AgentChatReasoningPanelComponent);