"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";

type Props = {
  readonly length?: number;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly autoFocus?: boolean;
  readonly className?: string;
  readonly "aria-label"?: string;
  /** When false, blocks browser OTP autofill from email/SMS. */
  readonly allowBrowserOtpAutofill?: boolean;
};

function digitsOnly(value: string, max: number): string {
  return value.replace(/\D/g, "").slice(0, max);
}

export function OtpDigitInput({
  length = 6,
  value,
  onChange,
  disabled = false,
  autoFocus = false,
  className,
  "aria-label": ariaLabel = "One-time code",
  allowBrowserOtpAutofill = false,
}: Props) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const digits = digitsOnly(value, length).padEnd(length, " ").slice(0, length).split("");

  const focusAt = useCallback((index: number) => {
    const el = inputsRef.current[index];
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  useEffect(() => {
    if (!autoFocus || disabled) return;
    focusAt(0);
  }, [autoFocus, disabled, focusAt]);

  const setDigit = useCallback(
    (index: number, char: string) => {
      const next = digitsOnly(value, length).split("");
      while (next.length < length) next.push("");
      next[index] = char;
      const joined = next.join("").replace(/\s/g, "").slice(0, length);
      onChange(joined);
    },
    [length, onChange, value],
  );

  const handleChange = (index: number, raw: string) => {
    const cleaned = digitsOnly(raw, length);
    if (cleaned.length === 0) {
      setDigit(index, "");
      return;
    }
    if (cleaned.length === 1) {
      setDigit(index, cleaned);
      if (index < length - 1) focusAt(index + 1);
      return;
    }
    // Multi-digit paste into one box
    const current = digitsOnly(value, length).split("");
    while (current.length < length) current.push("");
    for (let i = 0; i < cleaned.length && index + i < length; i += 1) {
      current[index + i] = cleaned[i]!;
    }
    const joined = current.join("").slice(0, length);
    onChange(joined);
    focusAt(Math.min(index + cleaned.length, length - 1));
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      const current = digitsOnly(value, length);
      if (current[index]) {
        setDigit(index, "");
        return;
      }
      if (index > 0) {
        e.preventDefault();
        setDigit(index - 1, "");
        focusAt(index - 1);
      }
      return;
    }
    if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      focusAt(index - 1);
      return;
    }
    if (e.key === "ArrowRight" && index < length - 1) {
      e.preventDefault();
      focusAt(index + 1);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = digitsOnly(e.clipboardData.getData("text"), length);
    if (!pasted) return;
    onChange(pasted);
    focusAt(Math.min(pasted.length, length) - 1);
  };

  return (
    <div
      className={cn("flex items-center justify-center gap-2", className)}
      role="group"
      aria-label={ariaLabel}
    >
      {Array.from({ length }, (_, index) => {
        const char = digits[index]?.trim() ?? "";
        return (
          <input
            key={index}
            ref={(el) => {
              inputsRef.current[index] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete={allowBrowserOtpAutofill && index === 0 ? "one-time-code" : "off"}
            maxLength={length}
            disabled={disabled}
            value={char}
            aria-label={`Digit ${index + 1} of ${length}`}
            onChange={(e) => handleChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={handlePaste}
            onFocus={(e) => e.currentTarget.select()}
            className={cn(
              "h-12 w-10 rounded-lg border border-zinc-700 bg-zinc-950 text-center text-lg font-semibold tabular-nums text-zinc-50 shadow-none outline-none transition-colors",
              "focus-visible:border-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-500/40",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "sm:h-12 sm:w-11",
            )}
          />
        );
      })}
    </div>
  );
}
