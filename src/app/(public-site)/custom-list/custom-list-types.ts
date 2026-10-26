export type CustomListPaymentToken = "ETH" | "USDC" | "SOL";
export type CustomListPricingDto = Readonly<{
  durationDays: 7;
  prices: Readonly<Record<CustomListPaymentToken, string | null>>;
  treasury: Readonly<{ evm: string | null; sol: string | null }>;
  testMode: boolean;
}>;
