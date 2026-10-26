"use client";
import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import { AgentChatApiError } from "../shared/errors";
import { agentChatApi } from "./api";
import { agentChatKeys } from "./query-keys";
import type {
  ConversationListResponse,
} from "../shared/contracts";
function shouldRetryQuery(failureCount: number, error: Error): boolean {
  if (error instanceof AgentChatApiError) {
    return error.retryable && error.status >= 500 && failureCount < 2;
  }
  return failureCount < 2;
}
// ── Models ──────────────────────────────────────────────────────────────────
export function useAgentChatModels(agentDbId: number) {
  return useQuery({
    queryKey: agentChatKeys.models(agentDbId),
    queryFn: ({ signal }) => agentChatApi.getModels(agentDbId, signal),
    staleTime: 5 * 60 * 1000, // 5 min
    retry: shouldRetryQuery,
    enabled: Number.isFinite(agentDbId) && agentDbId > 0,
  });
}
// ── Settings ────────────────────────────────────────────────────────────────
export function useAgentChatSettings(agentDbId: number) {
  return useQuery({
    queryKey: agentChatKeys.settings(agentDbId),
    queryFn: ({ signal }) => agentChatApi.getSettings(agentDbId, signal),
    staleTime: 30 * 1000, // 30s
    retry: shouldRetryQuery,
    enabled: Number.isFinite(agentDbId) && agentDbId > 0,
  });
}
export function useUpdateAgentChatSettings(agentDbId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof agentChatApi.updateSettings>[1]) =>
      agentChatApi.updateSettings(agentDbId, data),
    onMutate: async (newData) => {
      await queryClient.cancelQueries({
        queryKey: agentChatKeys.settings(agentDbId),
      });
      const previous = queryClient.getQueryData(
        agentChatKeys.settings(agentDbId),
      );
      queryClient.setQueryData(
        agentChatKeys.settings(agentDbId),
        (old: unknown) =>
          old && typeof old === "object" ? { ...old, ...newData } : newData,
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(
          agentChatKeys.settings(agentDbId),
          ctx.previous,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: agentChatKeys.settings(agentDbId),
      });
    },
  });
}
// ── Conversations ───────────────────────────────────────────────────────────
export function useAgentChatConversations(agentDbId: number) {
  return useInfiniteQuery<
    ConversationListResponse,
    Error,
    InfiniteData<ConversationListResponse>,
    ReturnType<typeof agentChatKeys.conversations>,
    string | null
  >({
    queryKey: agentChatKeys.conversations(agentDbId),
    queryFn: ({ pageParam, signal }) =>
      agentChatApi.getConversations(agentDbId, pageParam ?? undefined, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? null,
    staleTime: 30 * 1000, // explicit invalidation keeps the rail current
    retry: shouldRetryQuery,
    enabled: Number.isFinite(agentDbId) && agentDbId > 0,
  });
}
export function useAgentChatConversation(
  agentDbId: number,
  conversationId: string | null,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: agentChatKeys.conversation(agentDbId, conversationId ?? ""),
    queryFn: ({ signal }) =>
      agentChatApi.getConversation(agentDbId, conversationId!, signal),
    staleTime: 15 * 1000,
    refetchOnWindowFocus: false,
    retry: shouldRetryQuery,
    enabled: !!conversationId && options.enabled !== false,
  });
}
export function useRenameConversation(agentDbId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      title,
    }: {
      conversationId: string;
      title: string;
    }) => agentChatApi.renameConversation(agentDbId, conversationId, title),
    onMutate: async ({ conversationId, title }) => {
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: agentChatKeys.conversation(agentDbId, conversationId),
        }),
        queryClient.cancelQueries({
          queryKey: agentChatKeys.conversations(agentDbId),
        }),
      ]);
      // Optimistic update on the detail
      const previousDetail = queryClient.getQueryData(
        agentChatKeys.conversation(agentDbId, conversationId),
      );
      queryClient.setQueryData(
        agentChatKeys.conversation(agentDbId, conversationId),
        (old: unknown) =>
          old && typeof old === "object"
            ? {
                ...(old as Record<string, unknown>),
                conversation: {
                  ...((old as Record<string, unknown>).conversation as Record<
                    string,
                    unknown
                  >),
                  title,
                },
              }
            : old,
      );
      // Optimistic update on list
      const previousList = queryClient.getQueryData<
        InfiniteData<ConversationListResponse>
      >(agentChatKeys.conversations(agentDbId));
      if (previousList) {
        queryClient.setQueryData<InfiniteData<ConversationListResponse>>(
          agentChatKeys.conversations(agentDbId),
          {
            ...previousList,
            pages: previousList.pages.map((page) => ({
              ...page,
              items: page.items.map((item) =>
                item.id === conversationId ? { ...item, title } : item,
              ),
            })),
          },
        );
      }
      return { previousDetail, previousList };
    },
    onError: (_err, { conversationId }, ctx) => {
      if (ctx?.previousDetail) {
        queryClient.setQueryData(
          agentChatKeys.conversation(agentDbId, conversationId),
          ctx.previousDetail,
        );
      }
      if (ctx?.previousList) {
        queryClient.setQueryData(
          agentChatKeys.conversations(agentDbId),
          ctx.previousList,
        );
      }
    },
    onSettled: (_data, _err, { conversationId }) => {
      queryClient.invalidateQueries({
        queryKey: agentChatKeys.conversation(agentDbId, conversationId),
      });
      queryClient.invalidateQueries({
        queryKey: agentChatKeys.conversations(agentDbId),
      });
    },
  });
}
export function useDeleteConversation(agentDbId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      agentChatApi.deleteConversation(agentDbId, conversationId),
    onMutate: async (conversationId) => {
      await queryClient.cancelQueries({
        queryKey: agentChatKeys.conversations(agentDbId),
      });
      const previousList = queryClient.getQueryData<
        InfiniteData<ConversationListResponse>
      >(agentChatKeys.conversations(agentDbId));
      if (previousList) {
        queryClient.setQueryData<InfiniteData<ConversationListResponse>>(
          agentChatKeys.conversations(agentDbId),
          {
            ...previousList,
            pages: previousList.pages.map((page) => ({
              ...page,
              items: page.items.filter((item) => item.id !== conversationId),
            })),
          },
        );
      }
      return { previousList };
    },
    onError: (_err, _conversationId, ctx) => {
      if (ctx?.previousList) {
        queryClient.setQueryData(
          agentChatKeys.conversations(agentDbId),
          ctx.previousList,
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: agentChatKeys.conversations(agentDbId),
      });
    },
  });
}
export function useUpdateConversationStatus(agentDbId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      status,
    }: {
      conversationId: string;
      status: "ACTIVE" | "ARCHIVED";
    }) =>
      agentChatApi.updateConversationStatus(agentDbId, conversationId, status),
    onMutate: async ({ conversationId, status }) => {
      await queryClient.cancelQueries({
        queryKey: agentChatKeys.conversations(agentDbId),
      });
      const previousList = queryClient.getQueryData<
        InfiniteData<ConversationListResponse>
      >(agentChatKeys.conversations(agentDbId));
      queryClient.setQueryData<InfiniteData<ConversationListResponse>>(
        agentChatKeys.conversations(agentDbId),
        (old) =>
          old
            ? {
                ...old,
                pages: old.pages.map((page) => ({
                  ...page,
                  items: page.items.map((item) =>
                    item.id === conversationId ? { ...item, status } : item,
                  ),
                })),
              }
            : old,
      );
      return { previousList };
    },
    onSuccess: (conversation) => {
      queryClient.setQueryData<InfiniteData<ConversationListResponse>>(
        agentChatKeys.conversations(agentDbId),
        (old) =>
          old
            ? {
                ...old,
                pages: old.pages.map((page) => ({
                  ...page,
                  items: page.items.map((item) =>
                    item.id === conversation.id ? conversation : item,
                  ),
                })),
              }
            : old,
      );
    },
    onError: (_error, _variables, context) => {
      if (context?.previousList) {
        queryClient.setQueryData(
          agentChatKeys.conversations(agentDbId),
          context.previousList,
        );
      }
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: agentChatKeys.conversations(agentDbId),
      }),
  });
}
// ── Runs ────────────────────────────────────────────────────────────────────
export function useAgentChatRun(agentDbId: number, runId: string | null) {
  return useQuery({
    queryKey: agentChatKeys.run(agentDbId, runId ?? ""),
    queryFn: ({ signal }) => agentChatApi.getRun(agentDbId, runId!, signal),
    staleTime: 3 * 1000, // poll 3s while active
    retry: shouldRetryQuery,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && ["PREPARING", "RESERVED", "STREAMING"].includes(status)) {
        return 3 * 1000;
      }
      if (!status && runId) return query.state.error ? 10 * 1000 : 3 * 1000;
      return false;
    },
    enabled: !!runId,
  });
}
export function useCancelAgentChatRun(agentDbId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => agentChatApi.cancelRun(agentDbId, runId),
    onSuccess: (_data, runId) => {
      queryClient.invalidateQueries({
        queryKey: agentChatKeys.run(agentDbId, runId),
      });
    },
  });
}
// ── Billing / Credits ───────────────────────────────────────────────────────
export function useLlmCreditBalance() {
  return useQuery({
    queryKey: agentChatKeys.balance(),
    queryFn: ({ signal }) => agentChatApi.getBalance(signal),
    staleTime: 10 * 1000, // 10s
    retry: shouldRetryQuery,
  });
}
export function useLlmDepositConfig() {
  return useQuery({
    queryKey: agentChatKeys.depositConfig(),
    queryFn: ({ signal }) => agentChatApi.getDepositConfig(signal),
    staleTime: 5 * 60 * 1000, // 5 min
    retry: shouldRetryQuery,
  });
}
export function useLlmDeposits(limit = 20) {
  return useQuery({
    queryKey: [...agentChatKeys.deposits(), "list", limit] as const,
    queryFn: ({ signal }) => agentChatApi.listDeposits(limit, signal),
    staleTime: 15 * 1000,
    retry: shouldRetryQuery,
  });
}
export function useCreateLlmDeposit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof agentChatApi.createDeposit>[0]) =>
      agentChatApi.createDeposit(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: agentChatKeys.deposits(),
      });
      queryClient.invalidateQueries({
        queryKey: agentChatKeys.balance(),
      });
    },
  });
}
export function useLlmDeposit(depositId: string | null) {
  return useQuery({
    queryKey: agentChatKeys.deposit(depositId ?? ""),
    queryFn: ({ signal }) => agentChatApi.getDeposit(depositId!, signal),
    staleTime: 15 * 1000,
    retry: shouldRetryQuery,
    enabled: !!depositId,
  });
}
export function useSyncLlmDeposit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (depositId: string) => agentChatApi.syncDeposit(depositId),
    onSuccess: (_data, depositId) => {
      queryClient.invalidateQueries({
        queryKey: agentChatKeys.deposit(depositId),
      });
      queryClient.invalidateQueries({
        queryKey: agentChatKeys.deposits(),
      });
      queryClient.invalidateQueries({
        queryKey: agentChatKeys.balance(),
      });
    },
  });
}
export function useCancelLlmDeposit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (depositId: string) => agentChatApi.cancelDeposit(depositId),
    onSuccess: (_data, depositId) => {
      queryClient.invalidateQueries({
        queryKey: agentChatKeys.deposit(depositId),
      });
      queryClient.invalidateQueries({
        queryKey: agentChatKeys.deposits(),
      });
    },
  });
}
