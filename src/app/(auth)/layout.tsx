import { WalletProvider } from "@/providers/wallet-provider";

export default function AuthLayout({ children }: { readonly children: React.ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
