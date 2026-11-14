/**
 * Copilot rate limit: per visitor per hour, plus a global daily cap.
 *
 * Counters live in memory of the serving instance. On Vercel (Fluid compute) instances
 * are reused heavily, so this holds in practice, but it is approximate: a burst spread
 * across several fresh instances can exceed it. That's an accepted trade-off — the worst
 * case is the Gemini free-tier quota running out, at which point the copilot already
 * falls back to retrieval-only answers. No money is at stake on a free key.
 */
export const PER_IP_PER_HOUR = Number(process.env.COPILOT_PER_IP_PER_HOUR ?? 10);
export const GLOBAL_PER_DAY = Number(process.env.COPILOT_GLOBAL_PER_DAY ?? 400);

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const perIp = new Map<string, number[]>();
let global: number[] = [];

export interface Verdict {
  ok: boolean;
  reason?: "visitor" | "global";
  retryAfterS?: number;
  remaining: number;
}

export function check(ip: string, now = Date.now()): Verdict {
  global = global.filter((t) => now - t < DAY);
  const hits = (perIp.get(ip) ?? []).filter((t) => now - t < HOUR);
  if (perIp.size > 10_000) perIp.clear(); // bound memory under abuse
  if (global.length >= GLOBAL_PER_DAY) {
    return { ok: false, reason: "global", retryAfterS: Math.ceil((DAY - (now - global[0])) / 1000), remaining: 0 };
  }
  if (hits.length >= PER_IP_PER_HOUR) {
    perIp.set(ip, hits);
    return { ok: false, reason: "visitor", retryAfterS: Math.ceil((HOUR - (now - hits[0])) / 1000), remaining: 0 };
  }
  hits.push(now);
  global.push(now);
  perIp.set(ip, hits);
  return { ok: true, remaining: PER_IP_PER_HOUR - hits.length };
}

/** Test hook. */
export function _reset() {
  perIp.clear();
  global = [];
}
