import type {
  AdminVerifiedAgentDetailPayload,
  AdminVerifiedAgentsFilter,
  AdminVerifiedAgentsListPayload,
} from "./verified-agents-types";

export async function fetchAdminVerifiedAgents(params: {
  page: number;
  perPage: number;
  filter: AdminVerifiedAgentsFilter;
  search: string;
}): Promise<AdminVerifiedAgentsListPayload> {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    perPage: String(params.perPage),
    filter: params.filter,
  });
  if (params.search) searchParams.set("search", params.search);
  const response = await fetch(`/api/admin/verified-agents?${searchParams}`);
  if (!response.ok) throw new Error("Failed to load agents");
  return response.json() as Promise<AdminVerifiedAgentsListPayload>;
}

export async function fetchAdminVerifiedAgentDetail(
  id: number,
): Promise<AdminVerifiedAgentDetailPayload> {
  const response = await fetch(`/api/admin/verified-agents/${id}`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to load agent");
  return response.json() as Promise<AdminVerifiedAgentDetailPayload>;
}
