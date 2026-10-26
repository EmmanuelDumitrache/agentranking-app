"use client";
import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showToast } from "@/components/ui/toast-simple";
import { resolveImageUrl } from "@/lib/image-utils";
type AdminAgentImageFieldProps = Readonly<{
  label?: string;
  value: string;
  onChange: (value: string) => void;
  inputId?: string;
  uploadPrefix?: "agent-images" | "token-images";
}>;
export function AdminAgentImageField({
  label = "Profile image",
  value,
  onChange,
  inputId = "admin-agent-image",
  uploadPrefix = "agent-images",
}: AdminAgentImageFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const previewSrc = resolveImageUrl(value);
  async function handleFileSelect(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/admin/upload/image?prefix=${uploadPrefix}`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Upload failed");
      }
      onChange(data.url);
      showToast("Profile image uploaded", "success");
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
      <p className="text-xs font-medium text-foreground/90">{label}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
          {previewSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewSrc} alt="" className="size-full object-cover" />
          ) : (
            <span className="px-1 text-center text-[10px] text-muted-foreground">No image</span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="space-y-1.5">
            <Label htmlFor={inputId} className="sr-only">
              Image URL
            </Label>
            <Input
              id={inputId}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="https://… or /uploads/agent-images/…"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={uploading} asChild>
              <label className="cursor-pointer">
                <Upload className="size-3.5" aria-hidden />
                {uploading ? "Uploading…" : "Upload image"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void handleFileSelect(file);
                  }}
                />
              </label>
            </Button>
            {value.trim() ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
                Clear
              </Button>
            ) : null}
          </div>
          {uploadError ? <p className="text-xs text-destructive">{uploadError}</p> : null}
          <p className="text-[11px] text-muted-foreground leading-snug">
            PNG, JPEG, WebP, or GIF up to 5MB. Stored on VPS via upload API (local disk or Blob).
          </p>
        </div>
      </div>
    </div>
  );
}