"use client";

import { useSyncExternalStore } from "react";

type WindowDimensions = { readonly width: number; readonly height: number };
const SERVER_DIMENSIONS: WindowDimensions = { width: 0, height: 0 };
let cachedWidth = -1;
let cachedHeight = -1;
let cachedDimensions: WindowDimensions = SERVER_DIMENSIONS;

function getSnapshot(): WindowDimensions {
  const width = globalThis.window.innerWidth;
  const height = globalThis.window.innerHeight;
  if (width !== cachedWidth || height !== cachedHeight) {
    cachedWidth = width;
    cachedHeight = height;
    cachedDimensions = { width, height };
  }
  return cachedDimensions;
}

function subscribe(onStoreChange: () => void): () => void {
  globalThis.window.addEventListener("resize", onStoreChange);
  return () => globalThis.window.removeEventListener("resize", onStoreChange);
}

export function useWindowDimensions(): WindowDimensions {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_DIMENSIONS);
}
