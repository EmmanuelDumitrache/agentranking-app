/** Uses Node.js 26 collection upsert, with a defensive fallback for test runtimes. */
export function getOrInsertComputed<K, V>(
  map: Map<K, V>,
  key: K,
  createDefault: (key: K) => V,
): V {
  const nativeGetOrInsertComputed = map.getOrInsertComputed;
  if (typeof nativeGetOrInsertComputed === "function") {
    return nativeGetOrInsertComputed.call(map, key, createDefault);
  }
  const existing = map.get(key);
  if (existing !== undefined || map.has(key)) {
    return existing as V;
  }
  const defaultValue = createDefault(key);
  map.set(key, defaultValue);
  return defaultValue;
}
