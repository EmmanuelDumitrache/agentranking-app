export const STAKE_SITE_EASE = [0.22, 1, 0.36, 1] as const;
export const STAKE_SITE_VIEWPORT = {
  once: true,
  margin: "0px 0px -10% 0px" as const,
  amount: 0.18 as const,
};
/** Scroll reveal — fades up into place when section enters view. */
export const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0 },
};
