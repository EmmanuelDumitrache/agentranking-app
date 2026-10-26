import "server-only";

export type LavaraveConfig = {
  apiBaseUrl: string;
  apiKey: string;
  enabled: boolean;
};

export function getLavaraveConfig(): LavaraveConfig {
  const apiBaseUrl =
    process.env.LAVARAVE_API_BASE_URL?.trim() || "https://lavarave.wtf";
  const apiKey = process.env.LAVARAVE_X_API_KEY?.trim() ?? "";
  return {
    apiBaseUrl: apiBaseUrl.replace(/\/$/, ""),
    apiKey,
    enabled: Boolean(apiKey),
  };
}
