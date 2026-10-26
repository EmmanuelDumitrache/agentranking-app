"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";

const PIN_LENGTH = 4;

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  error?: boolean;
  className?: string;
};

export function ArCardPinInput({
  value,
  onChange,
  disabled = false,
  autoFocus = false,
  error = false,
  className,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const digits = Array.from({ length: PIN_LENGTH }, (_, index) => value[index] ?? "");

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const updateValue = useCallback(
    (next: string) => {
      onChange(next.replace(/\D/g, "").slice(0, PIN_LENGTH));
    },
    [onChange],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && value.length > 0) {
      event.preventDefault();
      updateValue(value.slice(0, -1));
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text");
    updateValue(pasted);
  };

  return (
    <div className={cn("relative", className)}>
      <input
        ref={inputRef}
        id={inputId}
        type="password"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={PIN_LENGTH}
        value={value}
        disabled={disabled}
        onChange={(event) => updateValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
        aria-label="4-digit freeze PIN"
      />
      <div
        className="grid grid-cols-4 gap-2.5"
        onClick={() => inputRef.current?.focus()}
        onKeyDown={() => inputRef.current?.focus()}
        role="presentation"
      >
        {digits.map((digit, index) => (
          <div
            key={`${inputId}-${index}`}
            className={cn(
              "flex h-14 items-center justify-center rounded-xl border bg-[linear-gradient(145deg,#09090b_0%,#18181b_55%,#27272a_100%)] font-mono text-xl font-semibold tracking-[0.2em] text-foreground shadow-inner shadow-black/20 ring-1 ring-white/10 transition",
              value.length === index && "border-foreground/40 ring-foreground/20",
              digit && "border-foreground/25",
              error && "border-destructive/50 ring-destructive/20",
            )}
          >
            {digit ? (
              <span className="size-2.5 rounded-full bg-foreground" aria-hidden />
            ) : (
              <span className="text-sm text-muted-foreground/40" aria-hidden>
                •
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function isPinComplete(value: string): boolean {
  return /^\d{4}$/.test(value);
}
