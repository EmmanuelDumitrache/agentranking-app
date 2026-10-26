"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle, Trash2, BadgeCheck } from "lucide-react";
import Link from "next/link";
export interface AdminCustomListingDto {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  description: string;
  isVerified: boolean;
  isCustomListed: boolean;
  supportedTrust: string;
  createdAt: string;
  owner: string;
  chain: { shortName: string; color: string };
  profilePath: string;
}
async function fetchCustomListings(): Promise<{ agents: AdminCustomListingDto[] }> {
  const res = await fetch("/api/admin/custom-listings");
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}
export function AdminCustomListingsClient({ initialData }: { readonly initialData: { agents: AdminCustomListingDto[] } }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-custom-listings"],
    queryFn: fetchCustomListings,
    initialData,
    staleTime: 60_000,
  });
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const removeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/custom-listings/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-custom-listings"] });
      setActionMsg("Agent removed.");
      setTimeout(() => setActionMsg(null), 3000);
    },
    onError: (err) => setActionMsg(`Error: ${err.message}`),
  });
  const approveMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/custom-listings/${id}/approve`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to approve");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-custom-listings"] });
      setActionMsg("Agent approved (promoted to verified).");
      setTimeout(() => setActionMsg(null), 3000);
    },
    onError: (err) => setActionMsg(`Error: ${err.message}`),
  });
  const agents = data?.agents ?? [];
  return (
    <div className="container max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Custom Listings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Free and custom-listed agents (unverified, not on-chain)
          </p>
        </div>
        <span className="text-sm text-muted-foreground">{agents.length} listings</span>
      </div>
      {actionMsg && (
        <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-2 text-sm text-green-400">
          {actionMsg}
        </div>
      )}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-400 flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          {error.message}
        </div>
      )}
      {!isLoading && agents.length === 0 && (
        <p className="text-sm text-muted-foreground">No custom listings yet.</p>
      )}
      {agents.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left py-2.5 px-4 font-medium text-muted-foreground text-xs">Agent</th>
                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">Chain</th>
                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">Type</th>
                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs">Created</th>
                <th className="text-right py-2.5 px-4 font-medium text-muted-foreground text-xs">Actions</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id} className="border-b border-border hover:bg-muted/20 transition-colors">
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-2">
                      {agent.isVerified ? (
                        <CheckCircle className="h-3.5 w-3.5 text-green-400 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                      )}
                      <div>
                        <Link
                          href={agent.profilePath}
                          target="_blank"
                          className="font-medium hover:text-primary transition-colors"
                        >
                          {agent.name}
                        </Link>
                        <p className="text-[10px] text-muted-foreground truncate max-w-xs">
                          {agent.description || "No description"}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="text-xs" style={{ color: agent.chain.color }}>{agent.chain.shortName}</span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${agent.supportedTrust === "free" ? "bg-green-500/15 text-green-400" : "bg-blue-500/15 text-blue-400"}`}>
                      {agent.supportedTrust === "free" ? "Free" : "Custom"}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-xs text-muted-foreground">
                    {new Date(agent.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {!agent.isVerified && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[10px] border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                          onClick={() => approveMutation.mutate(agent.id)}
                          disabled={approveMutation.isPending}
                        >
                          <BadgeCheck className="h-3 w-3 mr-1" />
                          Approve
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[10px] border-red-500/30 text-red-400 hover:bg-red-500/10"
                        onClick={() => removeMutation.mutate(agent.id)}
                        disabled={removeMutation.isPending}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
