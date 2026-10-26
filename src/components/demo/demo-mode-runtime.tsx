"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { DEMO_BLOCKED_EVENT, DEMO_BLOCKED_HEADER, DEMO_BLOCKED_MESSAGE } from "@/lib/demo-mode";

/**
 * Browser half of DEMO_MODE (the proxy is the server half).
 *
 * Launches, staking and payments sign in the browser before any API call, so
 * refusing writes on the server is not enough: every wallet the page can reach
 * (EIP-1193 / EIP-6963, injected Solana providers, Wallet Standard) is wrapped
 * so connecting or signing is rejected and the demo notice is shown instead.
 */

type Eip1193Provider = {
  request?: (args: { method: string; params?: unknown }) => Promise<unknown>;
  enable?: () => Promise<unknown>;
  providers?: Eip1193Provider[];
};

type MethodHost = Record<string, unknown>;

const BLOCKED_EVM_METHODS = new Set([
  "eth_requestAccounts",
  "wallet_requestPermissions",
  "eth_sendTransaction",
  "eth_signTransaction",
  "eth_sendRawTransaction",
  "eth_sign",
  "personal_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  "wallet_sendCalls",
]);

const BLOCKED_SOLANA_METHODS = [
  "connect",
  "signTransaction",
  "signAllTransactions",
  "signAndSendTransaction",
  "signAndSendAllTransactions",
  "signMessage",
  "signIn",
];

const BLOCKED_STANDARD_FEATURES = [
  "standard:connect",
  "solana:signTransaction",
  "solana:signAndSendTransaction",
  "solana:signMessage",
  "solana:signIn",
];

const guarded = new WeakSet<object>();

function announceBlocked(): void {
  window.dispatchEvent(new CustomEvent(DEMO_BLOCKED_EVENT));
}

function rejectAsDemo(): Promise<never> {
  announceBlocked();
  // 4001 is the EIP-1193 "user rejected" code, which every wallet UI already handles quietly.
  return Promise.reject(Object.assign(new Error(DEMO_BLOCKED_MESSAGE), { code: 4001 }));
}

function replaceMethods(host: MethodHost, names: readonly string[]): void {
  for (const name of names) {
    if (typeof host[name] !== "function") continue;
    try {
      host[name] = () => rejectAsDemo();
    } catch {
      // Frozen provider objects cannot be wrapped; the server still refuses their writes.
    }
  }
}

function guardEip1193(provider: Eip1193Provider | null | undefined): void {
  if (!provider || typeof provider !== "object" || guarded.has(provider)) return;
  guarded.add(provider);
  provider.providers?.forEach(guardEip1193);
  const request = provider.request?.bind(provider);
  if (request) {
    try {
      provider.request = (args) => (BLOCKED_EVM_METHODS.has(args?.method) ? rejectAsDemo() : request(args));
    } catch {
      // See replaceMethods.
    }
  }
  replaceMethods(provider as MethodHost, ["enable"]);
}

function guardSolanaProvider(provider: unknown): void {
  if (!provider || typeof provider !== "object" || guarded.has(provider)) return;
  guarded.add(provider);
  replaceMethods(provider as MethodHost, BLOCKED_SOLANA_METHODS);
}

function guardStandardWallet(wallet: unknown): void {
  const features = (wallet as { features?: Record<string, unknown> } | null)?.features;
  if (!features || guarded.has(features)) return;
  guarded.add(features);
  for (const name of BLOCKED_STANDARD_FEATURES) {
    const feature = features[name];
    if (feature && typeof feature === "object") {
      replaceMethods(feature as MethodHost, Object.keys(feature));
    }
  }
}

function guardInjectedWallets(): void {
  const w = window as unknown as Record<string, { solana?: unknown } | undefined>;
  guardEip1193(w.ethereum as Eip1193Provider | undefined);
  for (const provider of [w.solana, w.phantom?.solana, w.solflare, w.backpack?.solana, w.glowSolana]) {
    guardSolanaProvider(provider);
  }
}

function installWalletGuards(): () => void {
  guardInjectedWallets();

  const onAnnounce = (event: Event) => {
    guardEip1193((event as CustomEvent<{ provider?: Eip1193Provider }>).detail?.provider);
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  const registerStandard = (...wallets: unknown[]) => {
    wallets.forEach(guardStandardWallet);
    return () => {};
  };
  const onRegisterWallet = (event: Event) => {
    try {
      (event as CustomEvent<(api: { register: typeof registerStandard }) => void>).detail?.({
        register: registerStandard,
      });
    } catch {
      // A misbehaving wallet registration must not break the page.
    }
  };
  window.addEventListener("wallet-standard:register-wallet", onRegisterWallet);
  window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: { register: registerStandard } }));

  // Some extensions inject late; re-check right before any interaction can open a wallet.
  window.addEventListener("ethereum#initialized", guardInjectedWallets);
  document.addEventListener("pointerdown", guardInjectedWallets, true);
  document.addEventListener("keydown", guardInjectedWallets, true);

  return () => {
    window.removeEventListener("eip6963:announceProvider", onAnnounce);
    window.removeEventListener("wallet-standard:register-wallet", onRegisterWallet);
    window.removeEventListener("ethereum#initialized", guardInjectedWallets);
    document.removeEventListener("pointerdown", guardInjectedWallets, true);
    document.removeEventListener("keydown", guardInjectedWallets, true);
  };
}

/** Surface the proxy's refusals (API writes and Server Actions) as the demo notice. */
function installFetchNotice(): () => void {
  const originalFetch = window.fetch;
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await originalFetch(...args);
    if (response.status === 403 && response.headers.get(DEMO_BLOCKED_HEADER)) announceBlocked();
    return response;
  };
  return () => {
    window.fetch = originalFetch;
  };
}

export function DemoModeRuntime() {
  const [noticeOpen, setNoticeOpen] = useState(false);

  useEffect(() => {
    const removeWalletGuards = installWalletGuards();
    const removeFetchNotice = installFetchNotice();
    let hideTimer: number | undefined;
    const onBlocked = () => {
      setNoticeOpen(true);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setNoticeOpen(false), 9000);
    };
    window.addEventListener(DEMO_BLOCKED_EVENT, onBlocked);
    return () => {
      removeWalletGuards();
      removeFetchNotice();
      window.removeEventListener(DEMO_BLOCKED_EVENT, onBlocked);
      window.clearTimeout(hideTimer);
    };
  }, []);

  return (
    <>
      <div
        className="pointer-events-none fixed bottom-3 left-3 z-[120] flex items-center gap-2 rounded-full border border-[#303030] bg-[#181818]/95 px-3 py-1.5 text-[11px] font-medium tracking-wide text-[#d4d4d4] shadow-sm backdrop-blur"
        role="status"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
        Demo version
        <span className="hidden text-[#8a8a8a] sm:inline">· snapshot data, writes disabled</span>
      </div>
      {noticeOpen ? (
        <div
          className="fixed inset-x-3 bottom-14 z-[130] mx-auto max-w-md rounded-xl border border-[#303030] bg-[#181818] p-4 text-[#f1f1f1] shadow-lg sm:bottom-6"
          role="alertdialog"
          aria-labelledby="demo-notice-title"
          aria-describedby="demo-notice-body"
        >
          <div className="flex items-start gap-3">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <p id="demo-notice-title" className="text-sm font-semibold">
                Demo mode
              </p>
              <p id="demo-notice-body" className="mt-1 text-xs leading-relaxed text-[#aaa]">
                {DEMO_BLOCKED_MESSAGE} Everything else is clickable.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setNoticeOpen(false)}
              className="rounded-md p-1 text-[#8a8a8a] transition-colors hover:text-[#f1f1f1]"
              aria-label="Dismiss demo notice"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
