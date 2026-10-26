"use client";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";
export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};
export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      // Shrink to content so ml-auto / mr-auto actually pins left vs right.
      // items-start keeps avatars at the top corner of the bubble.
      "ui-chat-bubble group flex w-fit max-w-[min(100%,42rem)] flex-row items-start gap-2.5",
      from === "user"
        ? "is-user ml-auto flex-row-reverse"
        : "is-assistant mr-auto",
      className
    )}
    {...props}
  />
);
export type MessageContentProps = HTMLAttributes<HTMLDivElement>;
export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "ui-chat-bubble-body is-user:dark flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-[15px] leading-relaxed",
      "group-[.is-user]:rounded-2xl group-[.is-user]:border group-[.is-user]:border-border/60 group-[.is-user]:bg-muted/50 group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground group-[.is-user]:backdrop-blur-sm",
      "group-[.is-assistant]:rounded-2xl group-[.is-assistant]:border group-[.is-assistant]:border-border/50 group-[.is-assistant]:bg-background/55 group-[.is-assistant]:px-4 group-[.is-assistant]:py-3 group-[.is-assistant]:text-foreground group-[.is-assistant]:backdrop-blur-sm",
      className
    )}
    {...props}
  >
    {children}
  </div>
);
export type MessageActionsProps = ComponentProps<"div">;
export const MessageActions = ({
  className,
  children,
  ...props
}: MessageActionsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);
export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};
export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = "ghost",
  size = "icon-sm",
  ...props
}: MessageActionProps) => {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );
  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  return button;
};
export type MessageResponseProps = ComponentProps<typeof Streamdown>;
const streamdownPlugins = { cjk, code, math, mermaid };
export const MessageResponse = memo(
  ({ className, isAnimating, children, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      plugins={streamdownPlugins}
      isAnimating={isAnimating}
      {...props}
    >
      {children}
    </Streamdown>
  ),
);
MessageResponse.displayName = "MessageResponse";
