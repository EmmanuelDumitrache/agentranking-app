"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { LaunchTokenPendingScreen } from "@/components/dashboard/token-launch-pending-screen";
import { Button } from "@/components/ui/button";
import { publicKeys } from "@/lib/query-keys/public";
type Props = {
  readonly address: string;
};
const MAX_POLL_ATTEMPTS = 30;
/** Polls until the Robinhood launch row exists, then refreshes the server page. */
export function RobinhoodTokenPendingClient({ address }: Props) {
  const router = useRouter();
  const [started, setStarted] = useState(false);
  const attemptsRef = useRef(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setStarted(true), 2_000);
    return () => window.clearTimeout(timer);
  }, []);
  const launchReady = useQuery({
    queryKey: publicKeys.robinhoodLaunch(address),
    queryFn: async ({ signal }) => {
      attemptsRef.current += 1;
      try {
        const response = await fetch(
          `/api/robinhood/launches/${encodeURIComponent(address)}`,
          {
            cache: "no-store",
            signal,
          },
        );
        return response.ok;
      } catch {
        if (signal.aborted) throw signal.reason;
        return false;
      }
    },
    enabled: started,
    retry: false,
    staleTime: 0,
    refetchInterval: (query) => {
      if (query.state.data === true) return false;
      return attemptsRef.current >= MAX_POLL_ATTEMPTS ? false : 2_000;
    },
    refetchIntervalInBackground: false,
  });
  useEffect(() => {
    if (launchReady.data) router.refresh();
  }, [launchReady.data, router]);
  if (launchReady.data === false) {
    return (
      <div className="ui-panel space-y-4 p-8 text-center">
        <h2 className="text-lg font-semibold">Still indexing</h2>
        <p className="text-muted-foreground text-sm">
          Your launch confirmed on-chain, but the token page isn’t ready yet. Refresh in a moment.
        </p>
        <Button type="button" onClick={() => void launchReady.refetch()}>
          Check again
        </Button>
      </div>
    );
  }
  return (
    <LaunchTokenPendingScreen
      title="Loading your token"
      subtitle="Your launch is confirmed. We’re syncing the public token page…"
      phaseLabel={launchReady.isFetching ? "Checking launch index…" : "Starting…"}
    />
  );
}