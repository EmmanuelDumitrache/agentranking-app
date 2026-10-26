/**
 * Uses Node.js 26's native `Map#getOrInsert*` methods on the server while
 * retaining the same behavior in browser runtimes that have not shipped the
 * collection-upsert proposal yet.
 */
export function getOrInsert<K, V>(map: Map<K, V>, key: K, defaultValue: NoInfer<V>): V {
  const nativeGetOrInsert = map.getOrInsert;
  if (typeof nativeGetOrInsert === "function") {
    return nativeGetOrInsert.call(map, key, defaultValue);
  }
  const existing = map.get(key);
  if (existing !== undefined || map.has(key)) {
    return existing as V;
  }
  map.set(key, defaultValue);
  return defaultValue;
}
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
