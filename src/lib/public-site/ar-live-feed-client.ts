"use client";
import type { ArLiveFeedEvent } from "@/lib/public-site/ar-live-feed-types";
const FEED_URL = "/api/public/ar-live-feed";
type Subscriber = (event: ArLiveFeedEvent) => void;
const subscribers = new Set<Subscriber>();
const seenIds = new Set<string>();
const seenOrder: string[] = [];
let source: EventSource | null = null;
let snapshotSeeded = false;
function remember(id: string): boolean {
  if (seenIds.has(id)) return false;
  seenIds.add(id);
  seenOrder.push(id);
  while (seenOrder.length > 200) {
    const oldest = seenOrder.shift();
    if (oldest) seenIds.delete(oldest);
  }
  return true;
}
function notify(item: ArLiveFeedEvent): void {
  if (!remember(item.id)) return;
  for (const subscriber of subscribers) subscriber(item);
}
function dispatchItem(raw: Event): void {
  try {
    const payload = JSON.parse((raw as MessageEvent<string>).data) as { item?: ArLiveFeedEvent };
    if (payload.item) notify(payload.item);
  } catch {
    // Ignore malformed payloads; the EventSource connection remains healthy.
  }
}
function dispatchSnapshot(raw: Event): void {
  try {
    const payload = JSON.parse((raw as MessageEvent<string>).data) as { items?: ArLiveFeedEvent[] };
    const items = payload.items ?? [];
    if (!snapshotSeeded) {
      for (const item of items) remember(item.id);
      snapshotSeeded = true;
      return;
    }
    for (const item of [...items].reverse()) notify(item);
  } catch {
    // Ignore malformed snapshots.
  }
}
function ensureConnected(): void {
  if (source || subscribers.size === 0 || typeof EventSource === "undefined") return;
  source = new EventSource(FEED_URL);
  source.addEventListener("item", dispatchItem);
  source.addEventListener("snapshot", dispatchSnapshot);
  source.onerror = () => {
    // EventSource owns reconnect timing; snapshots recover unseen recent items. Do not close/recreate it here.
  };
}
export function subscribeArLiveFeed(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  ensureConnected();
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0 && source) {
      source.removeEventListener("item", dispatchItem);
      source.removeEventListener("snapshot", dispatchSnapshot);
      source.close();
      source = null;
      snapshotSeeded = false;
    }
  };
}
