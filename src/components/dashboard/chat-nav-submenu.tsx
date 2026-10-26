"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type MouseEvent,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSourceDraft } from "@/hooks/use-source-draft";
import { isDashboardNavActive } from "@/lib/dashboard/navigation";
import { MAX_ACTIVE_CONVERSATIONS_PER_AGENT } from "@/features/agent-chat/shared/constants";
import type {
  ConversationListResponse,
  ConversationSummary,
} from "@/features/agent-chat/shared/contracts";
import {
  useAgentChatConversations,
  useDeleteConversation,
  useRenameConversation,
} from "@/features/agent-chat/client/query-hooks";
import { agentChatKeys } from "@/features/agent-chat/client/query-keys";
import { requestAgentChatNewDraft } from "@/features/agent-chat/client/new-chat-events";
import {
  pushAgentChatConversationUrl,
  replaceAgentChatConversationUrl,
} from "@/features/agent-chat/client/url-state";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
type Props = {
  readonly agentDbId: number;
  readonly chatHref: string;
  readonly pathname: string;
  readonly onNavigate?: () => void;
  readonly nested?: boolean;
};
const TITLE_MAX = 120;
function relativeAge(iso: string, now: number): string {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
function openNewChatDraft(
  agentDbId: number,
  chatHref: string,
  onChatRoute: boolean,
  router: ReturnType<typeof useRouter>,
  startTransition: (callback: () => void) => void,
): void {
  if (onChatRoute) {
    // The mounted chat shell owns live stream state. Its event handler resets
    // the draft and shallowly updates the URL; an App Router navigation here
    // would remount the stream owner.
    requestAgentChatNewDraft(agentDbId);
    return;
  }
  startTransition(() => {
    router.push(`${chatHref}?new=1`, { scroll: false });
  });
}

function isPlainChatLinkClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
function mutationErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Something went wrong. Try again.";
}
type SettingsDialogProps = {
  readonly agentDbId: number;
  readonly chatHref: string;
  readonly pathname: string;
  readonly thread: ConversationSummary | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
};
function ChatThreadSettingsDialog({
  agentDbId,
  chatHref,
  pathname,
  thread,
  open,
  onOpenChange,
}: SettingsDialogProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [, startTransition] = useTransition();
  const renameConversation = useRenameConversation(agentDbId);
  const deleteConversation = useDeleteConversation(agentDbId);
  const formSourceKey = open ? thread?.id ?? null : null;
  const [title, setTitle] = useSourceDraft(formSourceKey, thread?.title || "New chat");
  const [confirmDelete, setConfirmDelete] = useSourceDraft(formSourceKey, false);
  const [formError, setFormError] = useSourceDraft<string | null>(formSourceKey, null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const busy = renameConversation.isPending || deleteConversation.isPending;
  useEffect(() => {
    if (!open || !thread) return;
    renameConversation.reset();
    deleteConversation.reset();
    // Only reset form when the dialog opens / target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional; mutation objects change identity
  }, [open, thread?.id]);
  const handleClose = useCallback(
    (nextOpen: boolean) => {
      if (busy) return;
      onOpenChange(nextOpen);
    },
    [busy, onOpenChange],
  );
  const handleSave = useCallback(() => {
    if (!thread || busy) return;
    const nextTitle = title.trim();
    if (!nextTitle) {
      setFormError("Enter a name for this chat.");
      return;
    }
    if (nextTitle.length > TITLE_MAX) {
      setFormError(`Name must be ${TITLE_MAX} characters or fewer.`);
      return;
    }
    setFormError(null);
    renameConversation.mutate(
      { conversationId: thread.id, title: nextTitle },
      {
        onSuccess: () => onOpenChange(false),
        onError: (error) => {
          setFormError(mutationErrorMessage(error));
        },
      },
    );
  }, [busy, onOpenChange, renameConversation, setFormError, thread, title]);
  const handleDelete = useCallback(() => {
    if (!thread || busy) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setFormError(null);
      return;
    }
    setFormError(null);
    const deletedId = thread.id;
    const wasActive = searchParams.get("conversation") === deletedId;
    deleteConversation.mutate(deletedId, {
      onSuccess: () => {
        onOpenChange(false);
        if (!wasActive) return;
        const list = queryClient.getQueryData<
          InfiniteData<ConversationListResponse>
        >(agentChatKeys.conversations(agentDbId));
        const nextThread =
          list?.pages
            .flatMap((page) => page.items)
            .find(
              (item) => item.status === "ACTIVE" && item.id !== deletedId,
            ) ?? null;
        if (nextThread) {
          if (pathname.startsWith(chatHref)) {
            replaceAgentChatConversationUrl(nextThread.id);
          } else {
            router.replace(`${chatHref}?conversation=${nextThread.id}`);
          }
        } else {
          openNewChatDraft(
            agentDbId,
            chatHref,
            pathname.startsWith(chatHref),
            router,
            startTransition,
          );
        }
      },
      onError: (error) => {
        setFormError(mutationErrorMessage(error));
      },
    });
  }, [
    agentDbId,
    busy,
    chatHref,
    confirmDelete,
    deleteConversation,
    onOpenChange,
    pathname,
    queryClient,
    router,
    searchParams,
    setConfirmDelete,
    setFormError,
    thread,
  ]);
  const displayTitle = thread?.title || "New chat";
  const errorMessage =
    formError ??
    mutationErrorMessage(renameConversation.error) ??
    mutationErrorMessage(deleteConversation.error);
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="ui-chat-thread-dialog border-[#212121] bg-[#181818] text-neutral-100 sm:max-w-md [&_[data-slot=dialog-close]]:text-neutral-500 [&_[data-slot=dialog-close]]:hover:bg-[#212121] [&_[data-slot=dialog-close]]:hover:text-neutral-100"
        showCloseButton={!busy}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
          if (!finePointer) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          titleInputRef.current?.focus();
          titleInputRef.current?.select();
        }}
      >
        <DialogHeader>
          <DialogTitle>Conversation settings</DialogTitle>
          <DialogDescription>
            Rename this chat or delete it permanently.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="chat-thread-title">Name</Label>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {title.length}/{TITLE_MAX}
              </span>
            </div>
            <Input
              ref={titleInputRef}
              id="chat-thread-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                if (formError) setFormError(null);
              }}
              maxLength={TITLE_MAX}
              disabled={busy}
              className="border-[#212121] bg-[#0f0f0f] text-neutral-100 placeholder:text-neutral-600 focus-visible:border-neutral-600 focus-visible:ring-neutral-700/40"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleSave();
                }
              }}
            />
          </div>
          <div className="rounded-lg border border-[#212121] bg-[#0f0f0f] p-3">
            {confirmDelete ? (
              <div className="space-y-3">
                <p className="text-sm text-foreground">
                  Delete “{displayTitle}”? This removes the chat and its
                  history.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={handleDelete}
                  >
                    {deleteConversation.isPending ? (
                      <>
                        <Loader2
                          aria-hidden
                          className="size-3.5 animate-spin motion-reduce:animate-none"
                        />
                        Deleting…
                      </>
                    ) : (
                      <>
                        <Trash2 aria-hidden className="size-3.5" />
                        Delete permanently
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto px-0 text-destructive hover:bg-transparent hover:text-destructive"
                disabled={busy}
                onClick={handleDelete}
              >
                <Trash2 aria-hidden className="size-3.5" />
                Delete chat
              </Button>
            )}
          </div>
          {errorMessage ? (
            <p className="text-sm text-destructive" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => handleClose(false)}
            className="border-[#212121] bg-[#181818] text-neutral-200 hover:bg-[#212121]"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || !title.trim()}
            onClick={handleSave}
            className="bg-neutral-100 text-neutral-950 hover:bg-white"
          >
            {renameConversation.isPending ? (
              <>
                <Loader2
                  aria-hidden
                  className="size-3.5 animate-spin motion-reduce:animate-none"
                />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export function DashboardChatNavSubmenu({
  agentDbId,
  chatHref,
  pathname,
  onNavigate,
  nested = false,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isNewChatPending, startNewChatTransition] = useTransition();
  const [threadsCollapsed, setThreadsCollapsed] = useState(false);
  const [relativeNow, setRelativeNow] = useState(() => Date.now());
  const activeConversationId = searchParams.get("conversation");
  const onChatRoute = pathname.startsWith(chatHref);
  const chatActive = isDashboardNavActive(pathname, chatHref) || onChatRoute;
  const { data, isPending, isError, refetch } =
    useAgentChatConversations(agentDbId);
  useEffect(() => {
    if (!chatActive) return;
    const interval = window.setInterval(() => setRelativeNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [chatActive]);
  const threads =
    data?.pages
      .flatMap((page) => page.items)
      .filter((item) => item.status === "ACTIVE")
      .slice(0, MAX_ACTIVE_CONVERSATIONS_PER_AGENT) ?? [];
  const latestThread = threads[0] ?? null;
  /** Open latest chat when one exists; otherwise empty chat with starter prompts. */
  const chatEntryHref = latestThread
    ? `${chatHref}?conversation=${latestThread.id}`
    : chatHref;
  const atLimit = threads.length >= MAX_ACTIVE_CONVERSATIONS_PER_AGENT;
  const draftingNew = onChatRoute && !activeConversationId;
  const handleNewChat = useCallback(() => {
    onNavigate?.();
    openNewChatDraft(
      agentDbId,
      chatHref,
      onChatRoute,
      router,
      startNewChatTransition,
    );
  }, [
    agentDbId,
    chatHref,
    onChatRoute,
    onNavigate,
    router,
    startNewChatTransition,
  ]);
  const [settingsThread, setSettingsThread] =
    useState<ConversationSummary | null>(null);
  return (
    <div className={cn("space-y-0.5", nested && "cx-nav-chat-nested")}>
      <div
        className={cn(
          "ui-nav-link group/chat",
          chatActive && "ui-nav-link--active",
        )}
      >
        <Link
          href={chatEntryHref}
          prefetch={onChatRoute ? false : undefined}
          onClick={(event) => {
            if (onChatRoute && isPlainChatLinkClick(event)) {
              event.preventDefault();
              pushAgentChatConversationUrl(latestThread?.id ?? null);
            }
            onNavigate?.();
          }}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-500"
          aria-current={
            chatActive &&
            (!activeConversationId ||
              activeConversationId === latestThread?.id)
              ? "page"
              : undefined
          }
        >
          <MessageSquare className="ui-nav-icon" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Chat</span>
        </Link>
        {atLimit ? (
          <span
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/50"
            title={`Max ${MAX_ACTIVE_CONVERSATIONS_PER_AGENT} chats per agent`}
            aria-label={`Max ${MAX_ACTIVE_CONVERSATIONS_PER_AGENT} chats per agent`}
          >
            <Plus className="size-3.5" aria-hidden />
          </span>
        ) : (
          <button
            type="button"
            onClick={handleNewChat}
            disabled={isNewChatPending}
            aria-busy={isNewChatPending}
            className={cn(
              "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
              "hover:bg-background/60 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500",
              "disabled:pointer-events-none disabled:opacity-70",
              draftingNew && "bg-[#212121] text-neutral-100",
            )}
            aria-label="New chat"
            title="New chat"
          >
            {isNewChatPending ? (
              <Loader2
                aria-hidden
                className="size-3.5 animate-spin motion-reduce:animate-none"
              />
            ) : (
              <Plus className="size-3.5" aria-hidden />
            )}
          </button>
        )}
        <button
          type="button"
          disabled={!chatActive}
          onClick={() => setThreadsCollapsed((collapsed) => !collapsed)}
          aria-label={threadsCollapsed ? "Expand chats" : "Collapse chats"}
          aria-expanded={chatActive ? !threadsCollapsed : undefined}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 disabled:pointer-events-none disabled:opacity-50"
        >
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 opacity-60 transition-transform motion-reduce:transition-none",
              chatActive && !threadsCollapsed && "rotate-180",
            )}
          />
        </button>
      </div>
      {chatActive && !threadsCollapsed ? (
        <div
          className={cn(
            "ui-chat-thread-list space-y-1",
            nested && "ui-chat-thread-list--nested",
          )}
        >
          {isPending && threads.length === 0 ? (
            <p className="flex items-center gap-1.5 px-2 py-1 text-[10px] leading-snug text-muted-foreground" role="status">
              <Loader2 aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />
              Loading chats…
            </p>
          ) : null}
          {isError && threads.length === 0 ? (
            <div className="flex items-center justify-between gap-2 px-2 py-1 text-[10px] leading-snug text-muted-foreground" role="alert">
              <span>Chats could not be loaded.</span>
              <button
                type="button"
                onClick={() => void refetch()}
                className="min-h-6 shrink-0 rounded px-1.5 text-neutral-300 hover:bg-background/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
              >
                Retry
              </button>
            </div>
          ) : null}
          {atLimit ? (
            <p className="px-2 py-1 text-[10px] leading-snug text-muted-foreground">
              Max {MAX_ACTIVE_CONVERSATIONS_PER_AGENT} chats per agent
            </p>
          ) : null}
          {threads.map((thread) => {
            const href = `${chatHref}?conversation=${thread.id}`;
            const selected =
              onChatRoute && activeConversationId === thread.id;
            return (
              <div
                key={thread.id}
                className={cn(
                  "ui-chat-thread-row group/thread flex items-center gap-1 transition-colors",
                  selected
                    ? "ui-chat-thread-row--active text-neutral-100"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Link
                  href={href}
                  prefetch={onChatRoute ? false : undefined}
                  onClick={(event) => {
                    if (onChatRoute && isPlainChatLinkClick(event)) {
                      event.preventDefault();
                      pushAgentChatConversationUrl(thread.id);
                    }
                    onNavigate?.();
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-500"
                  aria-current={selected ? "page" : undefined}
                >
                  <MessageSquare
                    className="size-3.5 shrink-0 opacity-55"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {thread.title || "New chat"}
                  </span>
                  <time
                    dateTime={thread.lastMessageAt}
                    suppressHydrationWarning
                    className="shrink-0 text-[10px] tabular-nums opacity-60"
                  >
                    {relativeAge(thread.lastMessageAt, relativeNow)}
                  </time>
                </Link>
                <button
                  type="button"
                  className={cn(
                    "ui-chat-thread-action mr-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
                    "hover:bg-background/60 hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500",
                    selected && "ui-chat-thread-action--active",
                  )}
                  aria-label={`Options for ${thread.title || "New chat"}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setSettingsThread(thread);
                  }}
                >
                  <MoreHorizontal className="size-3.5" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      <ChatThreadSettingsDialog
        agentDbId={agentDbId}
        chatHref={chatHref}
        pathname={pathname}
        thread={settingsThread}
        open={!!settingsThread}
        onOpenChange={(open) => {
          if (!open) setSettingsThread(null);
        }}
      />
    </div>
  );
}
