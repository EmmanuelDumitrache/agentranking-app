"use client";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";
interface Toast {
  id: number;
  message: string;
  type?: "success" | "error" | "info";
}
let toastId = 0;
const listeners: Array<(toast: Toast) => void> = [];
const DEDUPE_WINDOW_MS = 1200;
let lastToastKey = "";
let lastToastAt = 0;

export function showToast(message: string, type: Toast["type"] = "success") {
  const normalized = message.trim();
  if (!normalized) return;
  const key = `${type ?? "success"}:${normalized}`;
  const now = Date.now();
  if (key === lastToastKey && now - lastToastAt < DEDUPE_WINDOW_MS) {
    return;
  }
  lastToastKey = key;
  lastToastAt = now;
  const toast: Toast = { id: ++toastId, message: normalized, type };
  listeners.forEach((fn) => fn(toast));
}
function ToastIcon({ type }: { readonly type: Toast["type"] }) {
  const className = "ar-toast-icon h-4 w-4 shrink-0";
  if (type === "error") return <AlertCircle className={className} aria-hidden />;
  if (type === "info") return <Info className={className} aria-hidden />;
  return <CheckCircle2 className={cn(className, "ar-icon-ok")} aria-hidden />;
}
export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = timersRef.current;
    const handler = (toast: Toast) => {
      setToasts((prev) => [...prev, toast]);
      const ttl = toast.type === "error" ? 4500 : 2500;
      const timer = setTimeout(() => {
        timers.delete(timer)
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, ttl);
      timers.add(timer)
    };
    listeners.push(handler);
    return () => {
      const idx = listeners.indexOf(handler);
      if (idx >= 0) listeners.splice(idx, 1);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);
  if (toasts.length === 0) return null;
  return (
    <div className="ar-toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "ar-toast",
            toast.type === "error" && "ar-toast--error",
            toast.type === "info" && "ar-toast--info",
            (!toast.type || toast.type === "success") && "ar-toast--success",
          )}
        >
          <ToastIcon type={toast.type} />
          <span className="ar-toast-message">{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
