export const FAIRSCALE_CARD_TITLE = "FairScale Trust";
export const FAIRSCALE_ATTRIBUTION = "Independent trust signal";
export const FAIRSCALE_ASSESSED_BY = "Assessed by FairScale";

/** Compact empty-state value shown like a score. */
export const FAIRSCALE_NA_VALUE = "N/A";

/** Single empty-state line for agents without a FairScale score. */
export const FAIRSCALE_NOT_DETECTED_COPY = "Not detected by FairScale";

export const FAIRSCALE_MISSING_WALLET_COPY = FAIRSCALE_NOT_DETECTED_COPY;
export const FAIRSCALE_UNSUPPORTED_NETWORK_COPY = FAIRSCALE_NOT_DETECTED_COPY;
export const FAIRSCALE_PENDING_COPY = FAIRSCALE_NOT_DETECTED_COPY;
export const FAIRSCALE_UNAVAILABLE_COPY = FAIRSCALE_NOT_DETECTED_COPY;

export const FAIRSCALE_DISCLAIMER =
  "FairScale is an independent third-party trust signal and does not constitute an audit, guarantee or financial advice.";

export const FAIRSCALE_REQUEST_BUTTON = "Request assessment";
export const FAIRSCALE_REQUESTING_BUTTON = "Requesting…";
export const FAIRSCALE_REFRESH_BUTTON = "Refresh assessment";
export const FAIRSCALE_REFRESH_COOLDOWN_BUTTON = "Next refresh 24h";

export const FAIRSCALE_TOAST_SAVED = "FairScale assessment saved";
export const FAIRSCALE_TOAST_REFRESHED = "FairScale assessment updated";
export const FAIRSCALE_TOAST_COOLDOWN =
  "Already assessed — refresh available once per day";
export const FAIRSCALE_TOAST_FAILED = "FairScale request failed";

export function fairscaleEmptyStateCopy(
  _status: "pending" | "missing_wallet" | "unsupported_network" | "temporarily_unavailable" | "scored",
): string {
  return FAIRSCALE_NOT_DETECTED_COPY;
}
