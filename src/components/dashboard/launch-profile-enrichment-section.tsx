"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LAUNCH_ARCHETYPE_OPTIONS,
  LAUNCH_CAPABILITY_TAG_OPTIONS,
  previewLaunchAgentScore,
  type LaunchProfileEnrichmentFields,
  type LaunchProfileServiceInput,
} from "@/lib/agent-launch/launch-profile-enrichment";
import { cn } from "@/lib/utils";

type Props = {
  readonly enrichment: LaunchProfileEnrichmentFields;
  readonly onChange: (next: LaunchProfileEnrichmentFields) => void;
  readonly tokenFields: {
    name: string;
    description: string;
    imageUrl: string;
    symbol: string;
    twitter: string;
    telegram: string;
  };
  readonly agentName: string;
  readonly agentDescription: string;
  readonly agentImage: string;
  readonly hasAgentWallet: boolean;
  readonly disabled?: boolean;
  readonly hideWebsite?: boolean;
  readonly onSave?: () => Promise<void>;
};

function ScoreBar({
  label,
  score,
  max,
  missing,
}: {
  readonly label: string;
  readonly score: number;
  readonly max: number;
  readonly missing: string[];
}) {
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground/80">
          {score}/{max}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted/60">
        <div
          className="h-full rounded-full bg-emerald-500/80 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      {missing.length > 0 ? (
        <p className="text-muted-foreground text-[11px]">Missing: {missing.join(", ")}</p>
      ) : null}
    </div>
  );
}

export function LaunchProfileEnrichmentSection({
  enrichment,
  onChange,
  tokenFields,
  agentName,
  agentDescription,
  agentImage,
  hasAgentWallet,
  disabled = false,
  hideWebsite = false,
  onSave,
}: Props) {
  const [saving, setSaving] = useState(false);
  const score = useMemo(
    () =>
      previewLaunchAgentScore({
        name: tokenFields.name || agentName,
        description: tokenFields.description || agentDescription,
        image: agentImage,
        website: enrichment.website,
        twitter: tokenFields.twitter,
        telegram: tokenFields.telegram,
        github: enrichment.github,
        archetype: enrichment.archetype,
        capabilityTags: enrichment.capabilityTags,
        services: enrichment.services,
        hasAgentWallet,
        tokenImageUrl: tokenFields.imageUrl,
        tokenName: tokenFields.name,
        tokenSymbol: tokenFields.symbol,
      }),
    [enrichment, tokenFields, agentName, agentDescription, agentImage, hasAgentWallet],
  );

  const toggleTag = (tag: string) => {
    const upper = tag.toUpperCase();
    const has = enrichment.capabilityTags.includes(upper);
    onChange({
      ...enrichment,
      capabilityTags: has
        ? enrichment.capabilityTags.filter((t) => t !== upper)
        : [...enrichment.capabilityTags, upper],
    });
  };

  const updateService = (index: number, patch: Partial<LaunchProfileServiceInput>) => {
    const services = enrichment.services.map((row, i) =>
      i === index ? { ...row, ...patch } : row,
    );
    onChange({ ...enrichment, services });
  };

  const addService = () => {
    if (enrichment.services.length >= 8) return;
    onChange({
      ...enrichment,
      services: [...enrichment.services, { name: "WEB", endpoint: "", version: "" }],
    });
  };

  const removeService = (index: number) => {
    onChange({
      ...enrichment,
      services: enrichment.services.filter((_, i) => i !== index),
    });
  };

  return (
    <div className="ui-panel space-y-4 p-4">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Agent profile enrichment
        </p>
        <p className="text-muted-foreground text-sm">
          Optional details that improve your AR Score and public agent card after launch.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {!hideWebsite ? (
          <div className="space-y-2">
            <Label htmlFor="launch-website">Website</Label>
            <Input
              id="launch-website"
              value={enrichment.website}
              disabled={disabled}
              placeholder="https://youragent.com"
              onChange={(e) => onChange({ ...enrichment, website: e.target.value })}
            />
          </div>
        ) : null}
        <div className={cn("space-y-2", hideWebsite ? "sm:col-span-2" : "")}>
          <Label htmlFor="launch-github">GitHub</Label>
          <Input
            id="launch-github"
            value={enrichment.github}
            disabled={disabled}
            placeholder="https://github.com/org/repo"
            onChange={(e) => onChange({ ...enrichment, github: e.target.value })}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="launch-archetype">Archetype</Label>
          <select
            id="launch-archetype"
            value={enrichment.archetype}
            disabled={disabled}
            className="ui-launch-select"
            onChange={(e) => onChange({ ...enrichment, archetype: e.target.value })}
          >
            {LAUNCH_ARCHETYPE_OPTIONS.map((option) => (
              <option key={option.value || "none"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Capability tags</Label>
        <div className="flex flex-wrap gap-2">
          {LAUNCH_CAPABILITY_TAG_OPTIONS.map((tag) => {
            const active = enrichment.capabilityTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                disabled={disabled}
                className={cn(
                  "ui-launch-tag",
                  active && "ui-launch-tag--active",
                )}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label>Protocol services</Label>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || enrichment.services.length >= 8}
            onClick={addService}
          >
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
            Add service
          </Button>
        </div>
        {enrichment.services.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Add endpoints like WEB, FARCASTER, or ONCHAIN-DATA to surface on your agent profile.
          </p>
        ) : (
          <div className="space-y-2">
            {enrichment.services.map((service, index) => (
              <div
                key={`${service.name}-${index}`}
                className="grid gap-2 rounded-lg border border-border/60 bg-[#0f0f0f] p-3 sm:grid-cols-[120px_minmax(0,1fr)_auto]"
              >
                <Input
                  value={service.name}
                  disabled={disabled}
                  placeholder="WEB"
                  onChange={(e) => updateService(index, { name: e.target.value.toUpperCase() })}
                />
                <Input
                  value={service.endpoint}
                  disabled={disabled}
                  placeholder="https://… or @handle"
                  onChange={(e) => updateService(index, { endpoint: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  aria-label="Remove service"
                  onClick={() => removeService(index)}
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border/60 bg-[#0f0f0f] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Profile completeness preview</p>
            <p className="text-muted-foreground text-xs">Estimated AR Agent Score after launch</p>
          </div>
          <Badge variant="secondary" className="text-sm tabular-nums">
            {score.total} · {score.label}
          </Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ScoreBar
            label="Identity"
            score={score.identity.score}
            max={score.identity.max}
            missing={score.identity.missing}
          />
          <ScoreBar
            label="Capabilities"
            score={score.capabilities.score}
            max={score.capabilities.max}
            missing={score.capabilities.missing}
          />
          <ScoreBar
            label="Developer"
            score={score.developer.score}
            max={score.developer.max}
            missing={score.developer.missing}
          />
          <ScoreBar
            label="Tokenization"
            score={score.tokenization.score}
            max={score.tokenization.max}
            missing={score.tokenization.missing}
          />
        </div>
      </div>
      {onSave ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || saving}
            onClick={() => {
              setSaving(true);
              void onSave().finally(() => setSaving(false));
            }}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              "Save profile details"
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
