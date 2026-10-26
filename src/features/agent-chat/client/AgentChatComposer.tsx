"use client";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type ClipboardEvent,
} from "react";
import {
  CreditCard,
  ImagePlus,
  LoaderCircle,
  Plus,
  RefreshCw,
  Send,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ClientModelOption } from "../shared/contracts";
interface Props {
  status: "submitted" | "streaming" | "ready" | "error";
  onSend: (text: string, files?: FileList) => Promise<void> | void;
  onStop: () => void;
  isPreparing: boolean;
  selectedModel: ClientModelOption | null;
  isDisabled: boolean;
  disabledReason?: string;
  balanceCents?: number;
  balanceError?: boolean;
  onAddCredits?: () => void;
  onRetryBalance?: () => void;
  className?: string;
}
// A 1,499,982-byte file base64-encodes to 1,999,976 characters. Adding the
// longest supported data-URL prefix keeps the server payload below its
// 2,000,000-character file URL limit.
const MAX_TOTAL_ATTACHMENT_BYTES = 1_499_982;
const MAX_ATTACHMENTS = 15;
const MAX_MESSAGE_CHARS = 32_000;
const ATTACHMENTS_REMOVED_MESSAGE =
  "Attachments were removed because the selected model does not support images.";
const ATTACHMENTS_UNSUPPORTED_MESSAGE =
  "The selected model does not support image attachments. Choose a vision-capable model to attach images.";
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const IMAGE_ACCEPT = [...ALLOWED_IMAGE_TYPES].join(",");
const COMPOSER_ACTION_CLASS =
  "ui-chat-composer-action size-8 shrink-0 rounded-lg border-0 bg-transparent p-0 text-neutral-500 shadow-none hover:bg-[#212121] hover:text-neutral-100 disabled:pointer-events-none disabled:opacity-40";
function fileIdentity(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
}
function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}
function imageExtension(mediaType: string): string {
  if (mediaType === "image/jpeg") return "jpg";
  return mediaType.split("/")[1] || "png";
}
function normalizeImageFile(file: File): File {
  const extension = imageExtension(file.type);
  let filename =
    file.name.trim() ||
    `image-${file.lastModified || "upload"}-${file.size}.${extension}`;
  if (filename.length > 255) {
    const dotIndex = filename.lastIndexOf(".");
    const suffix =
      dotIndex > 0 && filename.length - dotIndex <= 20
        ? filename.slice(dotIndex)
        : `.${extension}`;
    filename = `${filename.slice(0, 255 - suffix.length)}${suffix}`;
  }
  if (filename === file.name) return file;
  return new File([file], filename, {
    type: file.type,
    lastModified: file.lastModified,
  });
}
function filesToFileList(files: File[]): FileList | undefined {
  if (files.length === 0) return undefined;
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  return transfer.files;
}
function AgentChatComposerComponent({
  status,
  onSend,
  onStop,
  isPreparing,
  selectedModel,
  isDisabled,
  disabledReason,
  balanceCents,
  balanceError = false,
  onAddCredits,
  onRetryBalance,
  className,
}: Props) {
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submissionPendingRef = useRef(false);
  const isStreaming = status === "streaming" || status === "submitted";
  const supportsAttachments = selectedModel?.capabilities.attachments ?? false;
  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const viewportCap = Math.max(96, Math.min(220, window.innerHeight * 0.35));
    const nextHeight = Math.min(textarea.scrollHeight, viewportCap);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > viewportCap ? "auto" : "hidden";
  }, []);
  useLayoutEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);
  const [previousSupportsAttachments, setPreviousSupportsAttachments] =
    useState(supportsAttachments);
  if (previousSupportsAttachments !== supportsAttachments) {
    setPreviousSupportsAttachments(supportsAttachments);
    if (!supportsAttachments && files.length > 0) {
      // Adjust attachment state during the prop transition rather than in an
      // Effect. This prevents rendering one frame with attachments that the new
      // model cannot accept and avoids a cascading setState-in-effect render.
      setFiles([]);
      setSubmissionError(null);
      setFileError(ATTACHMENTS_REMOVED_MESSAGE);
      setIsDraggingFiles(false);
    }
  }
  const totalAttachmentBytes = useMemo(
    () => files.reduce((sum, file) => sum + file.size, 0),
    [files],
  );
  const paidPlatformModel =
    !!selectedModel &&
    selectedModel.billingOwner === "platform" &&
    !selectedModel.isFree;
  const isLowBalance =
    paidPlatformModel &&
    balanceCents !== undefined &&
    balanceCents <= 0;
  const sendBlockedForCredits =
    paidPlatformModel && (isLowBalance || balanceError);
  const sendBlocked = isDisabled || sendBlockedForCredits;
  const hasContent = input.trim().length > 0 || files.length > 0;
  const canSend =
    hasContent && !isStreaming && !isPreparing && !sendBlocked;
  const sendTooltip = !hasContent
    ? "Write a message or attach an image"
    : sendBlockedForCredits
      ? (disabledReason ?? "Add credits or choose a free model")
      : disabledReason || "Send message";
  const addFiles = useCallback(
    (incoming: File[]) => {
      setSubmissionError(null);
      const seen = new Set(files.map(fileIdentity));
      const next = [...files];
      let totalBytes = totalAttachmentBytes;
      let unsupported = 0;
      let overCount = 0;
      let overSize = 0;
      for (const incomingFile of incoming) {
        if (!ALLOWED_IMAGE_TYPES.has(incomingFile.type)) {
          unsupported += 1;
          continue;
        }
        const file = normalizeImageFile(incomingFile);
        const identity = fileIdentity(file);
        if (seen.has(identity)) continue;
        if (next.length >= MAX_ATTACHMENTS) {
          overCount += 1;
          continue;
        }
        if (totalBytes + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
          overSize += 1;
          continue;
        }
        seen.add(identity);
        next.push(file);
        totalBytes += file.size;
      }
      const reasons: string[] = [];
      if (unsupported > 0) {
        reasons.push(
          `${unsupported} unsupported ${unsupported === 1 ? "image was" : "images were"} skipped`,
        );
      }
      if (overCount > 0)
        reasons.push(`up to ${MAX_ATTACHMENTS} images are allowed`);
      if (overSize > 0) reasons.push("attachments must total 1.5 MB or less");
      setFiles(next);
      setFileError(reasons.length > 0 ? `${reasons.join("; ")}.` : null);
    },
    [files, totalAttachmentBytes],
  );
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (
      (!text && files.length === 0) ||
      isStreaming ||
      isPreparing ||
      submissionPendingRef.current ||
      sendBlocked
    )
      return;
    submissionPendingRef.current = true;
    setSubmissionError(null);
    try {
      await onSend(text, filesToFileList(files));
      setInput("");
      setFiles([]);
      setFileError(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (error) {
      console.error("[agent-chat] failed to prepare message:", error);
      setSubmissionError(
        files.length > 0
          ? "Could not send this message with its attachments. Your draft is still here; try removing the images or sending again."
          : "Could not send this message. Your draft is still here; try again.",
      );
    } finally {
      submissionPendingRef.current = false;
    }
  }, [files, input, isPreparing, isStreaming, onSend, sendBlocked]);
  const handleFiles = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (event.target.files) addFiles(Array.from(event.target.files));
      event.target.value = "";
    },
    [addFiles],
  );
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing &&
        !isStreaming &&
        !isPreparing &&
        !sendBlocked
      ) {
        event.preventDefault();
        void handleSend();
      }
    },
    [handleSend, isPreparing, isStreaming, sendBlocked],
  );
  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const pastedFiles = Array.from(event.clipboardData.files).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (pastedFiles.length === 0) return;
      if (!supportsAttachments) {
        event.preventDefault();
        setSubmissionError(null);
        setFileError(ATTACHMENTS_UNSUPPORTED_MESSAGE);
        return;
      }
      if (isPreparing) return;
      event.preventDefault();
      addFiles(pastedFiles);
    },
    [addFiles, isPreparing, supportsAttachments],
  );
  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDraggingFiles(false);
      const droppedFiles = Array.from(event.dataTransfer.files);
      if (droppedFiles.length === 0) return;
      if (!supportsAttachments) {
        setSubmissionError(null);
        setFileError(ATTACHMENTS_UNSUPPORTED_MESSAGE);
        return;
      }
      if (isPreparing) return;
      if (droppedFiles.length > 0) addFiles(droppedFiles);
    },
    [addFiles, isPreparing, supportsAttachments],
  );
  const errorStatusText = submissionError ?? fileError;
  const blockedStatusText = sendBlocked
    ? (disabledReason ??
      (sendBlockedForCredits
        ? "Add credits or choose a free model to send this message."
        : "Chat is currently unavailable."))
    : null;
  const statusText = errorStatusText ?? blockedStatusText;
  const showStatusBar =
    !!statusText ||
    files.length > 0 ||
    input.length >= MAX_MESSAGE_CHARS * 0.9 ||
    isLowBalance ||
    (!!balanceError &&
      !!selectedModel &&
      selectedModel.billingOwner === "platform" &&
      !selectedModel.isFree) ||
    isPreparing ||
    isStreaming;
  const placeholder = isPreparing
    ? "Preparing attached images…"
    : isStreaming
      ? "Type your next message…"
      : isDisabled
        ? "Type a message…"
        : "Ask anything…";
  return (
    <div
      className={cn(
        "ui-chat-composer sticky bottom-0 z-10 shrink-0 !bg-[#0f0f0f] pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        className,
      )}
      aria-busy={isPreparing}
    >
      <div className="mx-auto w-full max-w-4xl px-3 sm:px-6">
        {files.length > 0 && (
          <div
            className="mb-2.5 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto"
            aria-label="Attached images"
          >
            {files.map((file) => (
              <span
                key={fileIdentity(file)}
                className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[#212121] bg-[#181818] py-1 pl-2 pr-1 text-xs text-neutral-300"
              >
                <ImagePlus
                  aria-hidden
                  className="size-3 shrink-0 text-muted-foreground"
                />
                <span className="max-w-44 truncate">{file.name}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {formatBytes(file.size)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-6"
                  disabled={isPreparing}
                  onClick={() => {
                    setSubmissionError(null);
                    setFileError(null);
                    setFiles((current) =>
                      current.filter(
                        (candidate) =>
                          fileIdentity(candidate) !== fileIdentity(file),
                      ),
                    );
                  }}
                  aria-label={`Remove ${file.name}`}
                >
                  <X aria-hidden className="size-3" />
                </Button>
              </span>
            ))}
          </div>
        )}
        <div
          className={cn(
            "ui-chat-composer-input relative rounded-[1.35rem] !bg-[#181818] transition-colors",
            isDraggingFiles &&
              supportsAttachments &&
              "ring-2 ring-neutral-500 ring-offset-2 ring-offset-transparent",
          )}
          onDragEnter={(event) => {
            event.preventDefault();
            if (supportsAttachments && !isPreparing) setIsDraggingFiles(true);
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
            }
          }}
          onDragLeave={(event) => {
            const relatedTarget = event.relatedTarget;
            if (
              !(relatedTarget instanceof Node) ||
              !event.currentTarget.contains(relatedTarget)
            ) {
              setIsDraggingFiles(false);
            }
          }}
          onDrop={handleDrop}
        >
          {isDraggingFiles && supportsAttachments ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-[1.1rem] border border-dashed border-neutral-500 bg-[#181818]/95 px-4 text-center text-sm font-medium text-neutral-200"
            >
              Drop images to attach
            </div>
          ) : null}
          <Textarea
            ref={textareaRef}
            value={input}
            maxLength={MAX_MESSAGE_CHARS}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
              setSubmissionError(null);
              setInput(event.target.value);
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            disabled={isPreparing}
            aria-label="Message input"
            aria-describedby={
              showStatusBar ? "agent-chat-composer-status" : undefined
            }
            title={disabledReason}
            rows={1}
            className={cn(
              "relative z-[1] max-h-[min(35dvh,220px)] min-h-14 resize-none overflow-y-hidden border-0 bg-transparent px-4 pb-10 pt-3.5 pr-12 text-[15px] leading-relaxed text-neutral-100 shadow-none placeholder:text-neutral-600 focus-visible:ring-0 sm:text-base",
              supportsAttachments && "pl-12",
            )}
          />
          {supportsAttachments ? (
            <div className="absolute bottom-2 left-2 z-[1]">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={COMPOSER_ACTION_CLASS}
                    disabled={isPreparing}
                    aria-label="Attach images"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Plus aria-hidden className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  Attach, paste, or drop PNG, JPEG, WebP, or GIF images
                </TooltipContent>
              </Tooltip>
            </div>
          ) : null}
          <div className="absolute bottom-2 right-2 z-[1] flex items-center">
            {isPreparing ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      COMPOSER_ACTION_CLASS,
                      "ui-chat-composer-action--busy",
                    )}
                    disabled
                    aria-label="Preparing message"
                  >
                    <LoaderCircle
                      aria-hidden
                      className="size-4 animate-spin motion-reduce:animate-none"
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Preparing message</TooltipContent>
              </Tooltip>
            ) : isStreaming ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      COMPOSER_ACTION_CLASS,
                      "ui-chat-composer-action--stop border border-[#343434] bg-[#252525] text-neutral-200 hover:bg-[#303030] hover:text-white",
                    )}
                    onClick={onStop}
                    aria-label="Stop generating"
                  >
                    <Square aria-hidden className="size-3 fill-current" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Stop generating</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      COMPOSER_ACTION_CLASS,
                      canSend
                        ? "ui-chat-composer-action--ready"
                        : "ui-chat-composer-action--idle",
                    )}
                    onClick={() => void handleSend()}
                    disabled={!canSend}
                    aria-label="Send message"
                  >
                    <Send aria-hidden className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{sendTooltip}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          className="hidden"
          onChange={handleFiles}
        />
      </div>
      {showStatusBar && (
        <div className="mx-auto flex min-h-8 w-full max-w-4xl flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-[11px] text-muted-foreground sm:px-6">
          <span
            id="agent-chat-composer-status"
            className={cn(
              "min-w-[12rem] flex-1 break-words leading-relaxed",
              errorStatusText && "text-destructive",
              blockedStatusText && !errorStatusText && "text-amber-300",
            )}
            role={errorStatusText ? "alert" : "status"}
            aria-live={errorStatusText ? "assertive" : "polite"}
            aria-atomic="true"
          >
            {statusText ??
              (isPreparing
                ? "Preparing attached images…"
                : isStreaming
                  ? "The agent is responding. You can keep drafting here."
                  : "")}
          </span>
          {files.length > 0 && (
            <span className="hidden shrink-0 tabular-nums sm:inline">
              {files.length}/{MAX_ATTACHMENTS} ·{" "}
              {formatBytes(totalAttachmentBytes)}
            </span>
          )}
          {input.length >= MAX_MESSAGE_CHARS * 0.9 && (
            <span className="shrink-0 tabular-nums">
              {input.length.toLocaleString()}/
              {MAX_MESSAGE_CHARS.toLocaleString()}
            </span>
          )}
          {isLowBalance && onAddCredits && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-6 shrink-0 gap-1 px-1.5 text-amber-600 hover:text-amber-700 dark:text-amber-400"
              onClick={onAddCredits}
            >
              <CreditCard aria-hidden className="size-3" />
              Add credits
            </Button>
          )}
          {balanceError &&
            selectedModel &&
            selectedModel.billingOwner === "platform" &&
            !selectedModel.isFree &&
            onRetryBalance && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="h-6 shrink-0 gap-1 px-1.5"
                onClick={onRetryBalance}
              >
                <RefreshCw aria-hidden className="size-3" />
                Retry credits
              </Button>
            )}
        </div>
      )}
    </div>
  );
}
export const AgentChatComposer = memo(AgentChatComposerComponent);
