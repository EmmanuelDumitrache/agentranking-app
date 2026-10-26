import { createRequire } from "node:module";
import type { Plugin, Action } from "solana-agent-kit";
import { safeErrorDetails } from "@/lib/security/sensitive-data-redaction";
let pluginsPromise: Promise<readonly Plugin[]> | null = null;
let pluginCatalogComplete = false;
let pluginCatalogRetryAt = 0;
const PLUGIN_CATALOG_RETRY_MS = 60_000;
const requireFromHere = createRequire(import.meta.url);
const PLUGIN_IMPORTS = [
  {
    name: "plugin-token",
    packageName: "@solana-agent-kit/plugin-token",
    import: () => import("@solana-agent-kit/plugin-token"),
    commonJs: () => requireFromHere("@solana-agent-kit/plugin-token"),
  },
  {
    name: "plugin-nft",
    packageName: "@solana-agent-kit/plugin-nft",
    import: () => import("@solana-agent-kit/plugin-nft"),
    commonJs: () => requireFromHere("@solana-agent-kit/plugin-nft"),
  },
  {
    name: "plugin-defi",
    packageName: "@solana-agent-kit/plugin-defi",
    import: () => import("@solana-agent-kit/plugin-defi"),
    commonJs: () => requireFromHere("@solana-agent-kit/plugin-defi"),
  },
  {
    name: "plugin-misc",
    packageName: "@solana-agent-kit/plugin-misc",
    import: () => import("@solana-agent-kit/plugin-misc"),
    commonJs: () => requireFromHere("@solana-agent-kit/plugin-misc"),
  },
  {
    name: "plugin-blinks",
    packageName: "@solana-agent-kit/plugin-blinks",
    import: () => import("@solana-agent-kit/plugin-blinks"),
    commonJs: () => requireFromHere("@solana-agent-kit/plugin-blinks"),
  },
] as const;
type PluginModule = { default?: Plugin } | Plugin;
type PluginLogger = {
  readonly warn: (...data: unknown[]) => void;
  readonly info: (...data: unknown[]) => void;
};
function unwrapPluginModule(mod: unknown): Plugin {
  const candidate = mod as PluginModule;
  return ((candidate as { default?: Plugin }).default ?? candidate) as Plugin;
}
const COMMONJS_RETRY_ERROR_CODES = new Set([
  "ERR_UNSUPPORTED_DIR_IMPORT",
  "ERR_MODULE_NOT_FOUND",
  "ERR_PACKAGE_PATH_NOT_EXPORTED",
  "ERR_EXPORT_MISSING",
]);
/** ESM interop failures that usually succeed via the package CommonJS export. */
const COMMONJS_RETRY_MESSAGE_PATTERNS = [
  "does not provide an export named",
  "named export",
  "directory import",
  // Turbopack-bundled Yellowstone 1.x can freeze its package-relative WASM
  // loader to a synthetic /ROOT path. The CommonJS package export keeps
  // Node's real package directory and can recover when that bundled path is
  // the only failure.
  "yellowstone_grpc_solana_encoding_wasm_bg.wasm",
] as const;
function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
function readErrorCause(error: unknown): unknown {
  if (typeof error !== "object" || error === null || !("cause" in error)) {
    return undefined;
  }
  return (error as { cause?: unknown }).cause;
}
function errorText(error: unknown): string {
  if (Error.isError(error)) {
    return `${error.name}: ${error.message}\n${error.stack ?? ""}`;
  }
  return String(error);
}
export function shouldRetryPluginImportWithCommonJs(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined; depth++) {
    if (visited.has(current)) break;
    visited.add(current);
    const code = readErrorCode(current);
    if (code && COMMONJS_RETRY_ERROR_CODES.has(code)) {
      return true;
    }
    const text = errorText(current);
    for (const retryCode of COMMONJS_RETRY_ERROR_CODES) {
      if (text.includes(retryCode)) {
        return true;
      }
    }
    const textLower = text.toLowerCase();
    for (const pattern of COMMONJS_RETRY_MESSAGE_PATTERNS) {
      if (textLower.includes(pattern)) {
        return true;
      }
    }
    current = readErrorCause(current);
  }
  return false;
}
/**
 * Load an SAK plugin through its ESM export first. Some published transitive
 * Solana packages still contain Node-incompatible ESM directory imports. The
 * official SAK plugins publish a CommonJS export as well, so retry that export
 * only for Node module-resolution failures instead of silently dropping an
 * entire plugin from the runtime catalog.
 */
export async function loadPluginSafe(params: {
  name: string;
  packageName: string;
  importer: () => Promise<unknown>;
  commonJsLoader?: () => unknown;
  logger?: PluginLogger;
}): Promise<Plugin | null> {
  const logger = params.logger ?? console;
  try {
    return unwrapPluginModule(await params.importer());
  } catch (error) {
    if (shouldRetryPluginImportWithCommonJs(error)) {
      try {
        if (!params.commonJsLoader) {
          throw new Error(
            `No CommonJS fallback loader is configured for ${params.packageName}`,
          );
        }
        const plugin = unwrapPluginModule(params.commonJsLoader());
        logger.info(
          `[agent-chat] Recovered ${params.name} through its CommonJS export after ESM resolution failed`,
        );
        return plugin;
      } catch (commonJsError) {
        logger.warn(
          `[agent-chat] Failed to load plugin ${params.name} through both ESM and CommonJS exports:`,
          Error.isError(commonJsError)
            ? commonJsError.message
            : String(commonJsError),
        );
        return null;
      }
    }
    logger.warn(
      `[agent-chat] Failed to load plugin ${params.name}:`,
      Error.isError(error) ? error.message : String(error),
    );
    return null;
  }
}
export async function loadAllPlugins(): Promise<readonly Plugin[]> {
  const now = Date.now();
  if (
    pluginsPromise
    && (pluginCatalogComplete || pluginCatalogRetryAt === 0 || now < pluginCatalogRetryAt)
  ) {
    return pluginsPromise;
  }

  // Load sequentially. Parallel dynamic import()/require() of these plugins
  // races nested CJS graphs (Irys / node-fetch / node:url) and can throw
  // uncaught errors that kill the Next.js process — surfacing as
  // "Failed to fetch" in the chat client. `pluginCatalogRetryAt === 0` marks
  // an in-flight load so concurrent consumers share the same promise.
  pluginCatalogComplete = false;
  pluginCatalogRetryAt = 0;
  pluginsPromise = (async () => {
    const results: Array<Plugin | null> = [];
    for (const {
      name,
      packageName,
      import: importer,
      commonJs,
    } of PLUGIN_IMPORTS) {
      results.push(
        await loadPluginSafe({
          name,
          packageName,
          importer,
          commonJsLoader: commonJs,
        }),
      );
    }
    pluginCatalogComplete = results.every((plugin) => plugin !== null);
    pluginCatalogRetryAt = pluginCatalogComplete
      ? Number.POSITIVE_INFINITY
      : Date.now() + PLUGIN_CATALOG_RETRY_MS;
    return results.filter((plugin): plugin is Plugin => plugin !== null);
  })().catch((error) => {
    // Keep the degraded result cached briefly. Immediate cache eviction caused
    // each catalog consumer in the same chat request to reload every plugin and
    // repeat the identical module-resolution warning.
    pluginCatalogComplete = false;
    pluginCatalogRetryAt = Date.now() + PLUGIN_CATALOG_RETRY_MS;
    console.warn("[agent-chat] Unexpected plugin catalog failure; continuing without Solana tools", {
      error: safeErrorDetails(error),
    });
    return [] as Plugin[];
  });
  return pluginsPromise;
}
export async function loadAllActions(): Promise<readonly Action[]> {
  const plugins = await loadAllPlugins();
  const actions: Action[] = [];
  const seen = new Set<string>();
  for (const plugin of plugins) {
    for (const action of plugin.actions) {
      if (seen.has(action.name)) {
        throw new Error(
          `Duplicate Solana Agent Kit action name: ${action.name} (${plugin.name})`,
        );
      }
      seen.add(action.name);
      actions.push(action);
    }
  }
  return actions;
}
