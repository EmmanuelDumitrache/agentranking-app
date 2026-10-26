/**
 * Client/server-safe power formula pieces. Must stay aligned with
 * `runRankProjectionQueries` in compute-ranks-queries.ts (the ROUND + GREATEST UPDATE).
 */
export type AgentPowerBaseFields = {
  score: number;
  activeBoosts: number;
  voteFireCount: number;
  votePooCount: number;
};
/**
 * Everything inside ROUND(...) before + adminPowerAdjust.
 * Must match: activeBoosts. Organic score and social votes are not DAO vote inputs.
 */
export function agentPowerBaseContrib(agent: AgentPowerBaseFields): number {
  void agent.score;
  void agent.voteFireCount;
  void agent.votePooCount;
  const boosts = Number(agent.activeBoosts) || 0;
  return boosts;
}
/** Same as persisted powerScore for a given base and integer admin adjust (before global recompute side effects). */
export function powerScoreFromBaseAndAdjust(base: number, adminAdjust: number): number {
  return Math.max(0, Math.round(base + adminAdjust));
}
export type SolveAdjustResult =
  | { ok: true; adjust: number }
  | { ok: false; message: string };
/**
 * Find integer adminPowerAdjust in [minA, maxA] such that
 * GREATEST(0, ROUND(base + adjust)) === target.
 * Uses monotonicity of f(a) = powerScoreFromBaseAndAdjust(base, a) in a.
 */
export function solveAdminAdjustForTargetPower(
  base: number,
  target: number,
  minA: number,
  maxA: number
): SolveAdjustResult {
  if (!Number.isInteger(target) || target < 0) {
    return { ok: false, message: "targetPowerScore must be a non-negative integer" };
  }
  const f = (a: number) => powerScoreFromBaseAndAdjust(base, a);
  if (target === 0) {
    if (f(minA) > 0) {
      return {
        ok: false,
        message: `Cannot set power to 0; computed power is at least ${f(minA)} for this agent within the adjustment range`,
      };
    }
    return { ok: true, adjust: minA };
  }
  if (f(maxA) < target || f(minA) > target) {
    return {
      ok: false,
      message: `Cannot reach power ${target} with adjustment between ${minA} and ${maxA} (achievable range ~${f(minA)}–${f(maxA)})`,
    };
  }
  let lo = minA;
  let hi = maxA;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (f(mid) < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  if (f(lo) === target) {
    return { ok: true, adjust: lo };
  }
  return {
    ok: false,
    message: `Cannot reach power ${target} with adjustment in [${minA}, ${maxA}]`,
  };
}
