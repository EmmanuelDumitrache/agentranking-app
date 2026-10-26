export const AGENT_LAUNCH_DRAFT_STORAGE_KEY = "agent-launch-draft-id";
export const AGENT_LAUNCH_STEP_STORAGE_KEY = "agent-launch-step";
export const AGENT_LAUNCH_TEMPLATE_STORAGE_KEY = "agent-launch-demo-template-id";
const DRAFT_URL_CONSUMED_KEY = "agent-launch-draft-url-consumed";
const RELOAD_GUARD_STORAGE_KEY = "agent-launch-reload-guard";
function readAgentDbIdFromUrl(): string | null {
  if (typeof globalThis.window === "undefined") return null;
  return new URLSearchParams(globalThis.window.location.search).get("agentDbId")?.trim() || null;
}
function readDraftIdFromUrl(): string | null {
  if (typeof globalThis.window === "undefined") return null;
  return new URLSearchParams(globalThis.window.location.search).get("draft")?.trim() || null;
}
function isForceNewLaunchUrl(): boolean {
  if (typeof globalThis.window === "undefined") return false;
  return new URLSearchParams(globalThis.window.location.search).get("new") === "1";
}
/** Session-stored draft only (not URL). */
export function readStoredAgentLaunchDraftId(): string | null {
  if (typeof globalThis.window === "undefined") return null;
  return sessionStorage.getItem(AGENT_LAUNCH_DRAFT_STORAGE_KEY);
}
/** Clear wizard session keys so `/launch` starts clean. */
export function clearAgentLaunchWizardSession(): void {
  if (typeof globalThis.window === "undefined") return;
  try {
    sessionStorage.removeItem(AGENT_LAUNCH_DRAFT_STORAGE_KEY);
    sessionStorage.removeItem(AGENT_LAUNCH_STEP_STORAGE_KEY);
    sessionStorage.removeItem(AGENT_LAUNCH_TEMPLATE_STORAGE_KEY);
    sessionStorage.removeItem(DRAFT_URL_CONSUMED_KEY);
    sessionStorage.removeItem(RELOAD_GUARD_STORAGE_KEY);
  } catch {
    /* private mode */
  }
}
export type DraftRestoreContext = {
  draftId: string | null;
  explicitDraftUrl: boolean;
  forceNew: boolean;
};
export type EmbeddedDraftRestoreOptions = {
  readonly agentDbId: number;
  readonly serverDraftId: string | null;
  readonly hasIndexedLaunch: boolean;
};
/** Embedded dashboard wizard: only restore the launch tied to this agent. */
export function resolveEmbeddedDraftRestoreContext(
  options: EmbeddedDraftRestoreOptions,
): DraftRestoreContext {
  if (typeof globalThis.window === "undefined") {
    return { draftId: null, explicitDraftUrl: false, forceNew: false };
  }
  clearAgentLaunchWizardSession();
  if (options.hasIndexedLaunch || !options.serverDraftId) {
    return { draftId: null, explicitDraftUrl: false, forceNew: false };
  }
  return {
    draftId: options.serverDraftId,
    explicitDraftUrl: true,
    forceNew: false,
  };
}
/** Resolve which draft (if any) to restore on wizard mount. */
export function resolveDraftRestoreContext(): DraftRestoreContext {
  if (typeof globalThis.window === "undefined") {
    return { draftId: null, explicitDraftUrl: false, forceNew: false };
  }
  if (isForceNewLaunchUrl()) {
    clearAgentLaunchWizardSession();
    return { draftId: null, explicitDraftUrl: false, forceNew: true };
  }
  const explicitDraft = readDraftIdFromUrl();
  const selectedAgentDbId = readAgentDbIdFromUrl();
  if (selectedAgentDbId && !explicitDraft) {
    try {
      sessionStorage.removeItem(AGENT_LAUNCH_DRAFT_STORAGE_KEY);
      sessionStorage.removeItem(AGENT_LAUNCH_STEP_STORAGE_KEY);
      sessionStorage.removeItem(AGENT_LAUNCH_TEMPLATE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return { draftId: null, explicitDraftUrl: false, forceNew: false };
  }
  if (explicitDraft) {
    try {
      sessionStorage.setItem(AGENT_LAUNCH_DRAFT_STORAGE_KEY, explicitDraft);
      sessionStorage.setItem(DRAFT_URL_CONSUMED_KEY, "1");
    } catch {
      /* ignore */
    }
    return { draftId: explicitDraft, explicitDraftUrl: true, forceNew: false };
  }
  return {
    draftId: readStoredAgentLaunchDraftId(),
    explicitDraftUrl: false,
    forceNew: false,
  };
}
export function persistAgentLaunchDraftId(id: string): void {
  if (typeof globalThis.window === "undefined") return;
  sessionStorage.setItem(AGENT_LAUNCH_DRAFT_STORAGE_KEY, id);
  // Never touch the URL here — Next.js App Router treats search-param history updates
  // as navigations and hard-reloads in dev (refresh loop on /launch).
}
/**
 * After a Phantom cross-host redirect, ?draft= may be present once. Copy it to sessionStorage
 * only — do not call history.replaceState (that retriggers App Router reload loops in dev).
 * Skipped when ?new=1 is present.
 */
export function consumeDraftQueryParamOnce(): void {
  if (typeof globalThis.window === "undefined") return;
  if (isForceNewLaunchUrl()) return;
  try {
    if (sessionStorage.getItem(DRAFT_URL_CONSUMED_KEY) === "1") return;
    sessionStorage.setItem(DRAFT_URL_CONSUMED_KEY, "1");
  } catch {
    return;
  }
  const draftFromUrl = readDraftIdFromUrl();
  if (!draftFromUrl) return;
  try {
    sessionStorage.setItem(AGENT_LAUNCH_DRAFT_STORAGE_KEY, draftFromUrl);
  } catch {
    /* private mode */
  }
}
export function persistAgentLaunchStep(step: number): void {
  if (typeof globalThis.window === "undefined") return;
  sessionStorage.setItem(AGENT_LAUNCH_STEP_STORAGE_KEY, String(step));
}
export function readAgentLaunchStep(): number | null {
  if (typeof globalThis.window === "undefined") return null;
  const raw = sessionStorage.getItem(AGENT_LAUNCH_STEP_STORAGE_KEY);
  if (!raw) return null;
  const step = Number.parseInt(raw, 10);
  return Number.isFinite(step) && step >= 0 ? step : null;
}
export function persistAgentLaunchTemplateId(templateId: string): void {
  if (typeof globalThis.window === "undefined") return;
  sessionStorage.setItem(AGENT_LAUNCH_TEMPLATE_STORAGE_KEY, templateId);
}
export function readAgentLaunchTemplateId(): string | null {
  if (typeof globalThis.window === "undefined") return null;
  return sessionStorage.getItem(AGENT_LAUNCH_TEMPLATE_STORAGE_KEY);
}
/** Keep draft id in redirect target when switching to plain localhost for Phantom. */
export function appendDraftIdToDevUrl(url: string, draftId: string | null): string {
  if (!draftId) return url;
  try {
    const next = new URL(url);
    if (!next.searchParams.has("draft")) {
      next.searchParams.set("draft", draftId);
    }
    return next.toString();
  } catch {
    return url;
  }
}
