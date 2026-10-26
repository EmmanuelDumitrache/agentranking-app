"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  FileUp,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DashboardAgentCreationConfigDto } from "@/lib/dashboard/account-creation.server";
import { showToast } from "@/components/ui/toast-simple";
import { useTransientState } from "@/hooks/use-transient-state";
type MigrationDoc = {
  schema: string;
  agent: {
    name: string;
    persona?: string;
    system_prompt?: string;
    model?: string;
    temperature?: number;
    enabled_skills?: string[];
    summary?: string;
  };
  source?: {
    platform?: string;
    agent_name?: string;
    notes?: string;
  };
};
const SECRET_KEYS = new Set([
  "apikey",
  "accesstoken",
  "refreshtoken",
  "privatekey",
  "secret",
  "password",
  "mnemonic",
  "seedphrase",
  "cookie",
  "sessiontoken",
  "sshkey",
]);
const PRIVATE_KEY_MARKERS = [
  "-----BEGIN PRIVATE KEY-----",
  "-----BEGIN RSA PRIVATE KEY-----",
  "-----BEGIN EC PRIVATE KEY-----",
  "-----BEGIN OPENSSH PRIVATE KEY-----",
] as const;
const PROVIDER_SECRET_PATTERN = /\bsk-[a-z0-9_-]{16,}/i;
const TOKEN_ASSIGNMENT_PATTERN = /\b(?:access|refresh)[_-]?token\s*[:=]/i;
type Props = {
  readonly creationConfig: DashboardAgentCreationConfigDto;
  readonly migrationPrompt: string;
};
const LAST_AGENT_STORAGE_KEY = "ar-dashboard-last-agent-id";
function rememberCreatedAgent(agentDbId: number): void {
  try {
    globalThis.localStorage.setItem(LAST_AGENT_STORAGE_KEY, String(agentDbId));
  } catch {
    // ignore
  }
}
function extractJson(raw: string): MigrationDoc | null {
  // Try raw JSON first
  try {
    return JSON.parse(raw) as MigrationDoc;
  } catch {
    // Try extracting from fenced ```json block
  }
  const openingFence = raw.indexOf("```");
  const contentStart =
    openingFence < 0 ? -1 : raw.indexOf("\n", openingFence + 3);
  const closingFence =
    contentStart < 0 ? -1 : raw.indexOf("```", contentStart + 1);
  if (contentStart >= 0 && closingFence > contentStart) {
    try {
      return JSON.parse(raw.slice(contentStart + 1, closingFence).trim()) as MigrationDoc;
    } catch {
      // fall through
    }
  }
  return null;
}
function containsSecretMaterial(value: unknown): boolean {
  if (typeof value === "string") {
    return (
      PRIVATE_KEY_MARKERS.some((marker) => value.includes(marker)) ||
      PROVIDER_SECRET_PATTERN.test(value) ||
      TOKEN_ASSIGNMENT_PATTERN.test(value)
    );
  }
  if (Array.isArray(value)) return value.some(containsSecretMaterial);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nestedValue]) => {
    const normalizedKey = key.toLowerCase().replaceAll(/[^a-z]/g, "");
    return SECRET_KEYS.has(normalizedKey) || containsSecretMaterial(nestedValue);
  });
}
function validateMigration(doc: unknown): { valid: false; error: string } | { valid: true; doc: MigrationDoc } {
  if (!doc || typeof doc !== "object") {
    return { valid: false, error: "Invalid JSON. Expected an object." };
  }
  const d = doc as Record<string, unknown>;
  if (d.schema !== "agentranking_agent_export") {
    return { valid: false, error: 'Schema must be "agentranking_agent_export".' };
  }
  if (!d.agent || typeof d.agent !== "object") {
    return { valid: false, error: 'Missing "agent" object.' };
  }
  const agent = d.agent as Record<string, unknown>;
  if (!agent.name || typeof agent.name !== "string" || agent.name.trim().length === 0) {
    return { valid: false, error: "Agent name is required." };
  }
  if (containsSecretMaterial(doc)) {
    return {
      valid: false,
      error:
        "This package appears to contain secrets. Remove credentials, private keys, API keys, or tokens and try again.",
    };
  }
  if ((agent.name as string).trim().length > 80) {
    return { valid: false, error: "Agent name must be 80 characters or fewer." };
  }
  if (
    agent.temperature !== undefined &&
    (typeof agent.temperature !== "number" ||
      agent.temperature < 0 ||
      agent.temperature > 2)
  ) {
    return { valid: false, error: "Temperature must be a number from 0 to 2." };
  }
  for (const field of ["persona", "system_prompt", "model", "summary"] as const) {
    if (agent[field] !== undefined && typeof agent[field] !== "string") {
      return { valid: false, error: `"agent.${field}" must be text.` };
    }
  }
  return {
    valid: true,
    doc: {
      schema: "agentranking_agent_export",
      agent: {
        name: agent.name as string,
        persona: (agent.persona as string) ?? (agent.system_prompt as string) ?? "",
        system_prompt: (agent.system_prompt as string) ?? (agent.persona as string) ?? "",
        model: (agent.model as string) ?? "",
        temperature:
          typeof agent.temperature === "number" ? agent.temperature : undefined,
        enabled_skills: Array.isArray(agent.enabled_skills)
          ? (agent.enabled_skills as string[]).filter((s) => typeof s === "string")
          : [],
        summary: (agent.summary as string) ?? "",
      },
      source: d.source && typeof d.source === "object"
        ? {
            platform: ((d.source as Record<string, unknown>).platform as string) ?? "",
            agent_name: ((d.source as Record<string, unknown>).agent_name as string) ?? "",
            notes: ((d.source as Record<string, unknown>).notes as string) ?? "",
          }
        : undefined,
    },
  };
}
export function DashboardImportAgentConfig({
  creationConfig,
  migrationPrompt,
}: Props) {
  const router = useRouter();
  const [rawJson, setRawJson] = useState("");
  const [parsed, setParsed] = useState<MigrationDoc | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useTransientState(false, 2000);
  const copyMigrationPrompt = async () => {
    try {
      await navigator.clipboard.writeText(migrationPrompt);
      setCopied(true);
      showToast("Migration prompt copied.", "success");
    } catch {
      showToast("Could not copy the migration prompt.", "error");
    }
  };
  const handleValidate = () => {
    const extracted = extractJson(rawJson);
    if (!extracted) {
      const message =
        "Could not parse JSON. Paste raw JSON or a fenced ```json block.";
      setValidationError(message);
      setParsed(null);
      showToast(message, "error");
      return;
    }
    const result = validateMigration(extracted);
    if (!result.valid) {
      setValidationError(result.error);
      setParsed(null);
      showToast(result.error, "error");
      return;
    }
    setValidationError(null);
    setParsed(result.doc);
    showToast("Migration package is valid.", "success");
  };
  const handleCreate = async () => {
    if (!parsed) return;
    if (!creationConfig.canCreate) {
      setError(`Agent limit reached (${creationConfig.maxAgents}).`);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/dashboard/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: parsed.agent.name.trim(),
          description: parsed.agent.summary?.trim() ?? "",
          persona: (parsed.agent.system_prompt || parsed.agent.persona || "").trim(),
          image: "",
          tags: parsed.agent.enabled_skills?.join(", ") ?? "",
          importSource: parsed.source,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const msg =
          payload && typeof payload === "object" && "error" in payload
            ? (payload as { error: string }).error
            : "Could not create agent";
        setError(msg);
        showToast(msg, "error");
        return;
      }
      const agentId = (payload as { agent?: { id?: number } })?.agent?.id;
      if (!agentId) {
        const message =
          "Agent was created but the response was incomplete. Refresh and check your agents list.";
        setError(message);
        showToast(message, "error");
        return;
      }
      rememberCreatedAgent(agentId);
      showToast(`${parsed.agent.name.trim()} imported successfully.`, "success");
      router.push(`/dashboard/agents/${agentId}`);
      router.refresh();
    } catch {
      const message = "Network error — check your connection and try again.";
      setError(message);
      showToast(message, "error");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="ui-onboarding-youtube ui-create-agent-page ui-dashboard-overview mx-auto w-full max-w-3xl space-y-4 px-4 py-6 text-[#f1f1f1] sm:px-6">
      <div className="ui-overview-summary overflow-hidden rounded-xl">
        <div className="ui-overview-identity px-4 py-3.5 sm:px-5">
          <h1>Import an agent</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Transfer an existing persona using a validated, secret-free JSON package.
          </p>
        </div>
      </div>
      {/* Steps */}
      <div className="ui-onboarding-youtube__panel ui-overview-panel overflow-hidden rounded-xl">
        <div className="ui-overview-panel-header flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
          <div>
            <p className="text-sm font-semibold">Generate the migration package</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The prompt excludes secrets and requests only supported fields.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void copyMigrationPrompt()}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy prompt"}
          </Button>
        </div>
        <div className="space-y-3 px-4 py-4 sm:px-5">
        <div className="space-y-2 text-sm">
          <div className="flex items-start gap-2 text-muted-foreground">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted/30 text-xs font-medium mt-0.5">
              1
            </span>
            <span>Copy the migration prompt and paste it into your current agent.</span>
          </div>
          <div className="flex items-start gap-2 text-muted-foreground">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted/30 text-xs font-medium mt-0.5">
              2
            </span>
            <span>Paste the JSON response from your agent back here.</span>
          </div>
        </div>
          <div className="flex items-start gap-2 rounded-lg bg-[#212121] p-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            Credentials, private keys, session data, and secret-bearing fields
            are rejected before import.
          </div>
        </div>
      </div>
      {/* Paste area */}
      <div className="ui-overview-panel overflow-hidden rounded-xl">
        <div className="ui-overview-panel-header px-4 py-3.5 sm:px-5">
          <p className="text-sm font-semibold">Add the JSON response</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Paste the response or upload a .json file.
          </p>
        </div>
        <div className="space-y-3 px-4 py-4 sm:px-5">
        <textarea
          value={rawJson}
          onChange={(e) => {
            setRawJson(e.target.value);
            setParsed(null);
            setValidationError(null);
          }}
          placeholder={`Paste the strict JSON response or a fenced \`\`\`json block here.
Example:
\`\`\`json
{
  "schema": "agentranking_agent_export",
  "agent": { "name": "My Agent", ... }
}
\`\`\``}
          rows={8}
          className="w-full resize-y rounded-xl border border-[#303030] bg-[#0f0f0f] px-4 py-3 font-mono text-sm text-[#f1f1f1] placeholder:text-[#717171] focus:border-[#717171] focus:outline-none focus:ring-1 focus:ring-[#717171]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={rawJson.trim().length === 0}
            onClick={handleValidate}
          >
            <Check className="mr-2 h-3.5 w-3.5" />
            Validate config
          </Button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#303030] px-4 py-2 text-sm font-medium transition-colors hover:bg-[#3f3f3f]">
            <FileUp className="size-4" aria-hidden />
            Upload JSON
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void file.text().then((content) => {
                    setRawJson(content);
                    setParsed(null);
                    setValidationError(null);
                    showToast("JSON file loaded.", "info");
                  });
                }
                event.target.value = "";
              }}
            />
          </label>
        </div>
        </div>
      </div>
      {/* Validation result */}
      {validationError ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-400">{validationError}</p>
        </div>
      ) : null}
      {/* Preview */}
      {parsed ? (
        <div className={cn(
          "ui-onboarding-youtube__panel ui-overview-panel space-y-4 rounded-xl border border-[#303030] bg-[#181818] p-4",
        )}>
          <div className="flex items-center gap-1 text-xs font-medium text-[#f1f1f1]">
            <Check className="h-3.5 w-3.5" />
            Valid migration config
          </div>
          <div className="flex items-start gap-4">
            <AgentAvatar image="" name={parsed.agent.name} size="lg" />
            <div className="min-w-0 space-y-1">
              <p className="font-semibold">{parsed.agent.name}</p>
              {parsed.agent.summary && (
                <p className="text-muted-foreground text-sm">{parsed.agent.summary}</p>
              )}
              {parsed.agent.enabled_skills && parsed.agent.enabled_skills.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {parsed.agent.enabled_skills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-md bg-muted/30 px-2 py-0.5 text-xs font-medium text-muted-foreground"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          {parsed.source?.platform && (
            <p className="text-muted-foreground text-xs">
              Migrated from {parsed.source.platform}
              {parsed.source.agent_name ? ` — ${parsed.source.agent_name}` : ""}
            </p>
          )}
          <Button
            className="w-full"
            onClick={() => void handleCreate()}
            disabled={loading || !creationConfig.canCreate}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="mr-2 h-4 w-4" />
            )}
            Create imported agent
          </Button>
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      ) : null}
    </div>
  );
}
