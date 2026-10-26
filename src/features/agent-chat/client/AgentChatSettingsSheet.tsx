"use client";
import {
  memo,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateAgentChatSettings } from "./query-hooks";
interface ChatSettings {
  enabled: boolean;
  persona: string | null;
  systemInstructions: string | null;
  greeting: string | null;
}
function AgentChatSettingsSheetComponent({
  agentDbId,
  open,
  onOpenChange,
  settings,
  isLoading,
  isError,
  onRetry,
}: {
  agentDbId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: ChatSettings | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && hasUnsavedChanges) {
      setDiscardConfirmOpen(true);
      return;
    }
    if (!nextOpen) setHasUnsavedChanges(false);
    onOpenChange(nextOpen);
  };
  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          className="ui-chat-settings-sheet w-full overflow-y-auto border-l border-[#212121] bg-[#0f0f0f] text-neutral-100 sm:max-w-lg [&_[data-slot=sheet-close]]:text-neutral-500 [&_[data-slot=sheet-close]]:hover:bg-[#181818] [&_[data-slot=sheet-close]]:hover:text-neutral-100"
        >
          <SheetHeader className="border-b border-[#212121]">
            <SheetTitle>Chat settings</SheetTitle>
            <SheetDescription>
              Configure how this agent introduces itself and responds in LLM
              chat.
            </SheetDescription>
          </SheetHeader>
          {isLoading && (
            <div
              className="space-y-5 px-4 pb-6"
              aria-label="Loading chat settings"
              role="status"
            >
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-32 w-full rounded-lg" />
              <Skeleton className="h-56 w-full rounded-lg" />
            </div>
          )}
          {isError && !isLoading && (
            <div
              className="mx-4 flex flex-col items-center gap-3 rounded-lg border border-[#212121] bg-[#181818] px-4 py-8 text-center"
              role="alert"
            >
              <AlertCircle
                aria-hidden
                className="size-8 text-muted-foreground/60"
              />
              <div className="space-y-1">
                <p className="text-sm font-medium">Settings unavailable</p>
                <p className="text-xs text-muted-foreground">
                  Chat settings could not be loaded.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRetry}
                className="border-[#212121] bg-[#181818] text-neutral-200 hover:bg-[#212121]"
              >
                <RefreshCw aria-hidden className="size-3.5" />
                Try again
              </Button>
            </div>
          )}
          {settings && (
            <SettingsForm
              key={`${agentDbId}:${open ? "open" : "closed"}`}
              agentDbId={agentDbId}
              initial={settings}
              onDirtyChange={setHasUnsavedChanges}
              onSaved={() => {
                setHasUnsavedChanges(false);
                onOpenChange(false);
              }}
            />
          )}
        </SheetContent>
      </Sheet>
      <AlertDialog
        open={discardConfirmOpen}
        onOpenChange={setDiscardConfirmOpen}
        title="Discard unsaved changes?"
        description="Your unsaved chat settings will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        variant="destructive"
        onConfirm={() => {
          setDiscardConfirmOpen(false);
          setHasUnsavedChanges(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}
export const AgentChatSettingsSheet = memo(AgentChatSettingsSheetComponent);
function normalizeText(value: string): string | null {
  return value.trim() || null;
}
function CharacterCount({ current, max }: { current: number; max: number }) {
  return (
    <span className="tabular-nums text-muted-foreground">
      {current.toLocaleString()}/{max.toLocaleString()}
    </span>
  );
}
function SettingsForm({
  agentDbId,
  initial,
  onDirtyChange,
  onSaved,
}: {
  agentDbId: number;
  initial: ChatSettings;
  onDirtyChange: (isDirty: boolean) => void;
  onSaved: () => void;
}) {
  const update = useUpdateAgentChatSettings(agentDbId);
  const [baseline] = useState(() => ({
    enabled: initial.enabled,
    persona: normalizeText(initial.persona ?? ""),
    systemInstructions: normalizeText(initial.systemInstructions ?? ""),
    greeting: normalizeText(initial.greeting ?? ""),
  }));
  const [enabled, setEnabled] = useState(baseline.enabled);
  const [persona, setPersona] = useState(baseline.persona ?? "");
  const [instructions, setInstructions] = useState(
    baseline.systemInstructions ?? "",
  );
  const [greeting, setGreeting] = useState(baseline.greeting ?? "");
  const payload = useMemo(
    () => ({
      enabled,
      greeting: normalizeText(greeting),
      persona: normalizeText(persona),
      systemInstructions: normalizeText(instructions),
    }),
    [enabled, greeting, instructions, persona],
  );
  const isDirty =
    payload.enabled !== baseline.enabled ||
    payload.greeting !== baseline.greeting ||
    payload.persona !== baseline.persona ||
    payload.systemInstructions !== baseline.systemInstructions;
  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isDirty || update.isPending) return;
    update.mutate(payload, { onSuccess: onSaved });
  };
  return (
    <form
      aria-busy={update.isPending}
      className="space-y-5 px-4 pb-6 [&_[data-slot=textarea]]:border-[#212121] [&_[data-slot=textarea]]:bg-[#181818] [&_[data-slot=textarea]]:text-neutral-100 [&_[data-slot=textarea]]:placeholder:text-neutral-600 [&_[data-slot=textarea]]:focus-visible:border-neutral-600 [&_[data-slot=textarea]]:focus-visible:ring-neutral-700/40"
      onSubmit={handleSubmit}
    >
      <div className="flex items-start justify-between gap-4 rounded-lg border border-[#212121] bg-[#181818] p-3">
        <div className="space-y-1">
          <Label htmlFor="chat-enabled">Enable chat</Label>
          <p
            id="chat-enabled-description"
            className="text-xs leading-relaxed text-muted-foreground"
          >
            When disabled, conversation history remains available but new LLM
            responses are blocked.
          </p>
        </div>
        <Checkbox
          id="chat-enabled"
          checked={enabled}
          disabled={update.isPending}
          onCheckedChange={(checked: boolean | "indeterminate") => {
            update.reset();
            setEnabled(checked === true);
          }}
          aria-describedby="chat-enabled-description"
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="chat-greeting">Greeting</Label>
          <CharacterCount current={greeting.length} max={1_000} />
        </div>
        <Textarea
          id="chat-greeting"
          maxLength={1_000}
          value={greeting}
          disabled={update.isPending}
          aria-describedby="chat-greeting-description"
          placeholder="Leave blank for the AgentRanking default greeting."
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
            update.reset();
            setGreeting(event.target.value);
          }}
          className="max-h-48"
        />
        <p
          id="chat-greeting-description"
          className="text-xs text-muted-foreground"
        >
          Displayed in the empty conversation state. Blank uses the
          AgentRanking-branded default. It is not sent as the user&apos;s
          message.
        </p>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="chat-persona">Persona</Label>
          <CharacterCount current={persona.length} max={2_000} />
        </div>
        <Textarea
          id="chat-persona"
          maxLength={2_000}
          value={persona}
          disabled={update.isPending}
          placeholder="Describe the agent's voice, role, and response style within AgentRanking."
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
            update.reset();
            setPersona(event.target.value);
          }}
          className="max-h-64"
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="chat-instructions">Creator instructions</Label>
          <CharacterCount current={instructions.length} max={8_000} />
        </div>
        <Textarea
          id="chat-instructions"
          rows={8}
          maxLength={8_000}
          value={instructions}
          disabled={update.isPending}
          aria-describedby="chat-instructions-description"
          placeholder="Add task-specific operating guidance for this agent."
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
            update.reset();
            setInstructions(event.target.value);
          }}
          className="max-h-[45dvh]"
        />
        <p
          id="chat-instructions-description"
          className="text-xs leading-relaxed text-muted-foreground"
        >
          Safety policies and read-only tool rules always take precedence over
          creator instructions.
        </p>
      </div>
      {update.isError && (
        <div
          className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          role="alert"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            {update.error instanceof Error
              ? update.error.message
              : "Could not save chat settings."}
          </span>
        </div>
      )}
      <div className="sticky bottom-0 -mx-4 border-t border-[#212121] bg-[#0f0f0f]/95 px-4 py-3 backdrop-blur">
        <Button
          type="submit"
          className="w-full bg-neutral-100 text-neutral-950 hover:bg-white"
          disabled={update.isPending || !isDirty}
        >
          {update.isPending ? (
            <>
              <Loader2
                aria-hidden
                className="size-4 animate-spin motion-reduce:animate-none"
              />
              Saving settings…
            </>
          ) : isDirty ? (
            "Save settings"
          ) : (
            "No changes to save"
          )}
        </Button>
      </div>
    </form>
  );
}
