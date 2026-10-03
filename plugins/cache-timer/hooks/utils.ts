import type { SessionRateLimit } from "claude-code";

export type CacheTTL = "5m" | "1h";

export const TTL_MS: Record<CacheTTL, number> = { "5m": 5 * 60_000, "1h": 60 * 60_000 };

// What a past request proved, and whether the account was over its limit then.
export type Observed = { ttl: CacheTTL; isOverLimit: boolean };

export type CacheSignals = {
  env: (name: string) => string | undefined;
  setting: unknown;
  rateLimits: readonly SessionRateLimit[];
  observed?: Observed;
};

function isCacheTTL(value: unknown): value is CacheTTL {
  return value === "5m" || value === "1h";
}

function isOn(value: string | undefined) {
  return value !== undefined && ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function isOverLimit(rateLimits: readonly SessionRateLimit[]) {
  return rateLimits.some(
    (limit) =>
      (limit.kind === "five_hour" || limit.kind === "seven_day") && limit.percentUsed >= 100,
  );
}

// Same order Claude Code picks it in; the main thread is on its 1h allowlist.
export function getCacheTTL({ env, setting, rateLimits, observed }: CacheSignals): CacheTTL {
  if (isOn(env("FORCE_PROMPT_CACHING_5M"))) return "5m";
  const fromEnv = env("CLAUDE_CODE_PROMPT_CACHE_TTL");
  if (isCacheTTL(fromEnv)) return fromEnv;
  if (isCacheTTL(setting)) return setting;
  if (isOn(env("ENABLE_PROMPT_CACHING_1H"))) return "1h";
  if (isOn(env("CLAUDE_CODE_USE_BEDROCK")) && isOn(env("ENABLE_PROMPT_CACHING_1H_BEDROCK"))) {
    return "1h";
  }
  // Only subscribers get rate-limit windows, and only they get 1h by default.
  if (rateLimits.length === 0) return observed?.ttl ?? "5m";
  const overLimit = isOverLimit(rateLimits);
  if (observed !== undefined && observed.isOverLimit === overLimit) return observed.ttl;
  // Past the limit and still answered means extra usage, which drops to 5m.
  return overLimit ? "5m" : "1h";
}

// Lifetime Claude Code used on resume, when the gap tells them apart.
export function ttlFromResume(gapMs: number, isLikelyExpired: boolean): CacheTTL | undefined {
  if (gapMs <= TTL_MS["5m"] || gapMs >= TTL_MS["1h"]) return undefined;
  return isLikelyExpired ? "5m" : "1h";
}

// A near-full cache read after a 5m+ gap proves 1h; a miss proves nothing.
export function provesOneHour(gapMs: number, cacheRead: number, previousPrompt: number) {
  return (
    gapMs > TTL_MS["5m"] &&
    gapMs < TTL_MS["1h"] &&
    previousPrompt > 0 &&
    cacheRead >= 0.9 * previousPrompt
  );
}
