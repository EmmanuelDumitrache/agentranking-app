"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CardDevToolsPanel } from "@/components/treasury/card-dev-tools-panel";
import { treasuryKeys } from "@/lib/query-keys/treasury";
import {
  useTreasuryCards,
  type TreasuryCard,
} from "@/components/treasury/treasury-query-hooks";

type Props = {
  initialCards?: TreasuryCard[];
};

export function CardPageDevTools({ initialCards = [] }: Props) {
  const queryClient = useQueryClient();
  const { data } = useTreasuryCards({
    initialData: initialCards.length
      ? { cards: initialCards }
      : undefined,
  });
  const cards =
    data?.cards ??
    (data?.card ? [data.card] : []);

  async function refreshCards() {
    await queryClient.invalidateQueries({
      queryKey: treasuryKeys.cards(),
    });
  }

  return <CardDevToolsPanel cards={cards} onChanged={() => refreshCards()} />;
}