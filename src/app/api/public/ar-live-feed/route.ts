import { arLiveFeedHub } from "@/lib/public-site/ar-live-feed-hub.server";
import type { ArLiveFeedEvent } from "@/lib/public-site/ar-live-feed-types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEARTBEAT_MS = 20_000;
const PENDING_EVENT_LIMIT = 64;
const PENDING_BYTE_LIMIT = 2 * 1024 * 1024;
function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  (timer as unknown as { unref?: () => void }).unref?.();
}
export async function GET(request: Request): Promise<Response> {
  const encoder = new TextEncoder();
  const pendingChunks: Uint8Array[] = [];
  let pendingBytes = 0;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let cleanup: (closeController?: boolean) => void = () => undefined;
  const flushPending = () => {
    const controller = streamController;
    if (!controller || closed) return;
    while (
      pendingChunks.length > 0 &&
      (controller.desiredSize === null || controller.desiredSize > 0)
    ) {
      const chunk = pendingChunks.shift()!;
      pendingBytes -= chunk.byteLength;
      try {
        controller.enqueue(chunk);
      } catch {
        cleanup();
        return;
      }
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      const pendingItems: ArLiveFeedEvent[] = [];
      let snapshotSent = false;
      const onAbort = () => cleanup();
      cleanup = (closeController = true) => {
        if (closed) return;
        closed = true;
        request.signal.removeEventListener("abort", onAbort);
        unsubscribe?.();
        unsubscribe = null;
        if (heartbeat) clearTimeout(heartbeat);
        heartbeat = null;
        pendingChunks.length = 0;
        pendingBytes = 0;
        if (closeController) {
          try {
            controller.close();
          } catch {
            // The stream may already be closed by the client abort/cancel path.
          }
        }
        streamController = null;
      };
      const send = (chunk: string): boolean => {
        if (closed) return false;
        const encoded = encoder.encode(chunk);
        flushPending();
        if (
          pendingChunks.length === 0 &&
          (controller.desiredSize === null || controller.desiredSize > 0)
        ) {
          try {
            controller.enqueue(encoded);
            return true;
          } catch {
            cleanup();
            return false;
          }
        }
        if (
          pendingChunks.length >= PENDING_EVENT_LIMIT ||
          pendingBytes + encoded.byteLength > PENDING_BYTE_LIMIT
        ) {
          // Do not retain an unbounded queue for a stalled client or proxy.
          // EventSource reconnects using the advertised retry interval.
          cleanup();
          return false;
        }
        pendingChunks.push(encoded);
        pendingBytes += encoded.byteLength;
        return true;
      };
      const sendEvent = (
        event: "snapshot" | "item",
        payload: unknown,
        id?: string,
      ): boolean => {
        try {
          return send(
            `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
          );
        } catch {
          cleanup();
          return false;
        }
      };
      request.signal.addEventListener("abort", onAbort, { once: true });
      const initialize = async () => {
        if (!send("retry: 5000\n\n")) return;
        const subscription = await arLiveFeedHub.subscribe((item) => {
          if (!snapshotSent) {
            if (pendingItems.length >= PENDING_EVENT_LIMIT) pendingItems.shift();
            pendingItems.push(item);
            return;
          }
          sendEvent("item", { item }, item.id);
        });
        if (closed) {
          subscription();
          return;
        }
        unsubscribe = subscription;
        const snapshot = arLiveFeedHub.getLatest();
        const snapshotIds = new Set(snapshot.map((item) => item.id));
        if (!sendEvent("snapshot", { items: snapshot })) return;
        snapshotSent = true;
        for (const item of pendingItems) {
          if (!snapshotIds.has(item.id) && !sendEvent("item", { item }, item.id)) return;
        }
        pendingItems.length = 0;
        const scheduleHeartbeat = () => {
          heartbeat = setTimeout(() => {
            heartbeat = null;
            if (closed) return;
            if (send(`: heartbeat ${new Date().toISOString()}\n\n`)) {
              scheduleHeartbeat();
            }
          }, HEARTBEAT_MS);
          unrefTimer(heartbeat);
        };
        scheduleHeartbeat();
      };
      void initialize().catch(() => cleanup());
    },
    pull() {
      flushPending();
    },
    cancel() {
      cleanup(false);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
