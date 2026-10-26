"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, ZoomIn } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLocalAsyncResource } from "@/hooks/use-local-async-resource";
import { useSourceDraft } from "@/hooks/use-source-draft";
import {
  bannerOutputDimensionsLabel,
  bannerViewportSize,
  defaultCropState,
  loadImageFromFile,
  renderCroppedBannerWebp,
  type ImageCropState,
} from "@/lib/client-image-crop";
const VIEWPORT_WIDTH = 320;
type ImageCropDialogProps = {
  readonly open: boolean;
  readonly file: File | null;
  readonly title?: string;
  readonly description?: string;
  readonly onClose: () => void;
  readonly onCropped: (file: File) => void | Promise<void>;
};
export function ImageCropDialog({
  open,
  file,
  title = "Crop banner image",
  description = `Drag to reposition and zoom. Saved as ${bannerOutputDimensionsLabel()} WebP — same wide slot as the live corner popup.`,
  onClose,
  onCropped,
}: ImageCropDialogProps) {
  const viewport = useMemo(() => bannerViewportSize(VIEWPORT_WIDTH), []);
  const loadImage = useCallback(async (signal: AbortSignal) => {
    if (!open || !file) return null;
    const loaded = await loadImageFromFile(file);
    if (signal.aborted) {
      URL.revokeObjectURL(loaded.objectUrl);
      throw signal.reason;
    }
    return loaded;
  }, [open, file]);
  const imageResource = useLocalAsyncResource(
    `image-crop:${open}:${file?.name ?? "none"}:${file?.size ?? 0}:${file?.lastModified ?? 0}`,
    loadImage,
  );
  const loadedImage = imageResource.data;
  const objectUrl = loadedImage?.objectUrl ?? null;
  const imgSize = useMemo(
    () => loadedImage ? { width: loadedImage.width, height: loadedImage.height } : null,
    [loadedImage],
  );
  const [crop, setCrop] = useSourceDraft<ImageCropState>(objectUrl, defaultCropState());
  const loading = Boolean(open && file) && imageResource.loading;
  const [applying, setApplying] = useState(false);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  useEffect(() => {
    if (imageResource.error) onClose();
  }, [imageResource.error, onClose]);
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);
  const displayScale = imgSize
    ? Math.max(viewport.width / imgSize.width, viewport.height / imgSize.height) * crop.zoom
    : 1;
  const displayW = imgSize ? imgSize.width * displayScale : 0;
  const displayH = imgSize ? imgSize.height * displayScale : 0;
  const imgLeft = viewport.width / 2 - displayW / 2 + crop.offsetX;
  const imgTop = viewport.height / 2 - displayH / 2 + crop.offsetY;
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!imgSize) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      ox: crop.offsetX,
      oy: crop.offsetY,
    };
  }, [crop.offsetX, crop.offsetY, imgSize]);
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    setCrop((prev) => ({
      ...prev,
      offsetX: drag.ox + dx,
      offsetY: drag.oy + dy,
    }));
  }, [setCrop]);
  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }, []);
  async function handleApply() {
    if (!file) return;
    setApplying(true);
    try {
      const cropped = await renderCroppedBannerWebp(file, crop, VIEWPORT_WIDTH);
      await onCropped(cropped);
      onClose();
    } finally {
      setApplying(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next: boolean) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[22rem] gap-4">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div
            className="relative mx-auto overflow-hidden rounded-xl border border-border bg-black/40 touch-none select-none"
            style={{ width: viewport.width, height: viewport.height }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {loading || !objectUrl || !imgSize ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <RuntimeImage
                src={objectUrl}
                alt="Crop preview"
                draggable={false}
                className="absolute max-w-none pointer-events-none"
                style={{
                  width: displayW,
                  height: displayH,
                  left: imgLeft,
                  top: imgTop,
                }}
              />
            )}
            <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-primary/50 rounded-xl" />
          </div>
          <div className="flex items-center gap-3 px-0.5">
            <ZoomIn className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              type="range"
              min={1}
              max={3}
              step={0.02}
              value={crop.zoom}
              onChange={(e) => setCrop((prev) => ({ ...prev, zoom: Number(e.target.value) }))}
              className="min-w-0 flex-1 accent-primary"
              aria-label="Zoom"
            />
            <span className="text-xs text-muted-foreground w-10 shrink-0 text-right tabular-nums">
              {crop.zoom.toFixed(1)}×
            </span>
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={onClose}
            disabled={applying}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={() => void handleApply()}
            disabled={loading || applying || !file}
          >
            {applying ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Applying…
              </>
            ) : (
              "Apply crop"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
