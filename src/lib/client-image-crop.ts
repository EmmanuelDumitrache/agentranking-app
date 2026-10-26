/** Matches live corner popup: `sm:w-64` × `h-36` (16:9). */
export const BANNER_ASPECT_WIDTH = 64;
export const BANNER_ASPECT_HEIGHT = 36;
export const BANNER_OUTPUT_WIDTH = 1024;
export const BANNER_OUTPUT_HEIGHT = Math.round(
  (BANNER_OUTPUT_WIDTH * BANNER_ASPECT_HEIGHT) / BANNER_ASPECT_WIDTH,
);
export type ImageCropState = {
  zoom: number;
  offsetX: number;
  offsetY: number;
};
export function bannerOutputDimensionsLabel(): string {
  return `${BANNER_OUTPUT_WIDTH}×${BANNER_OUTPUT_HEIGHT}`;
}
export function bannerViewportSize(maxWidth = 320): { width: number; height: number } {
  return {
    width: maxWidth,
    height: Math.round((maxWidth * BANNER_ASPECT_HEIGHT) / BANNER_ASPECT_WIDTH),
  };
}
export function defaultCropState(): ImageCropState {
  return { zoom: 1, offsetX: 0, offsetY: 0 };
}
export async function loadImageFromFile(
  file: File,
): Promise<{ width: number; height: number; objectUrl: string }> {
  const objectUrl = URL.createObjectURL(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = objectUrl;
  });
  return { width: image.naturalWidth, height: image.naturalHeight, objectUrl };
}
export function computeSourceCropRect(
  imgWidth: number,
  imgHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  state: ImageCropState,
): { sx: number; sy: number; sw: number; sh: number } {
  const baseScale = Math.max(viewportWidth / imgWidth, viewportHeight / imgHeight);
  const scale = baseScale * state.zoom;
  const displayW = imgWidth * scale;
  const displayH = imgHeight * scale;
  const imgLeft = viewportWidth / 2 - displayW / 2 + state.offsetX;
  const imgTop = viewportHeight / 2 - displayH / 2 + state.offsetY;
  const sxRaw = (0 - imgLeft) / scale;
  const syRaw = (0 - imgTop) / scale;
  const sxEnd = (viewportWidth - imgLeft) / scale;
  const syEnd = (viewportHeight - imgTop) / scale;
  const sx = Math.max(0, sxRaw);
  const sy = Math.max(0, syRaw);
  const sw = Math.min(imgWidth, sxEnd) - sx;
  const sh = Math.min(imgHeight, syEnd) - sy;
  const targetAspect = viewportWidth / viewportHeight;
  let cropW = sw;
  let cropH = sh;
  if (sw / sh > targetAspect) {
    cropW = sh * targetAspect;
  } else {
    cropH = sw / targetAspect;
  }
  const cx = sx + sw / 2;
  const cy = sy + sh / 2;
  return {
    sx: Math.max(0, Math.min(imgWidth - cropW, cx - cropW / 2)),
    sy: Math.max(0, Math.min(imgHeight - cropH, cy - cropH / 2)),
    sw: Math.max(1, cropW),
    sh: Math.max(1, cropH),
  };
}
export async function renderCroppedBannerWebp(
  file: File,
  state: ImageCropState,
  viewportWidth = 320,
): Promise<File> {
  const viewport = bannerViewportSize(viewportWidth);
  const bitmap = await createImageBitmap(file);
  const { sx, sy, sw, sh } = computeSourceCropRect(
    bitmap.width,
    bitmap.height,
    viewport.width,
    viewport.height,
    state,
  );
  const canvas = document.createElement("canvas");
  canvas.width = BANNER_OUTPUT_WIDTH;
  canvas.height = BANNER_OUTPUT_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Image cropping is not supported in this browser");
  }
  context.drawImage(
    bitmap,
    sx,
    sy,
    sw,
    sh,
    0,
    0,
    BANNER_OUTPUT_WIDTH,
    BANNER_OUTPUT_HEIGHT,
  );
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.86),
  );
  if (!blob) throw new Error("Could not crop banner image");
  const baseName = file.name.replace(/\.[^.]+$/, "") || "banner";
  return new File([blob], `${baseName}-banner.webp`, { type: "image/webp" });
}