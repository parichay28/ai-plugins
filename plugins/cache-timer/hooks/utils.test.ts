import type { SessionRateLimit } from "claude-code";
import { expect, test } from "claude-code/testing";
import { getCacheTTL, provesOneHour, ttlFromResume, type CacheSignals } from "./utils";

const MINUTE = 60_000;
const UNDER: SessionRateLimit[] = [{ kind: "five_hour", percentUsed: 40 }];
const OVER: SessionRateLimit[] = [{ kind: "five_hour", percentUsed: 100 }];

function signals(input: Partial<CacheSignals> = {}, vars: Record<string, string> = {}) {
  return {
    env: (name: string) => vars[name],
    setting: undefined,
    rateLimits: UNDER,
    ...input,
  };
}

test("subscribers get 1h, API keys 5m", async () => {
  expect(getCacheTTL(signals())).toBe("1h");
  expect(getCacheTTL(signals({ rateLimits: [] }))).toBe("5m");
});

test("extra usage drops to 5m", async () => {
  expect(getCacheTTL(signals({ rateLimits: OVER }))).toBe("5m");
});

test("overrides win in Claude Code's order", async () => {
  expect(getCacheTTL(signals({}, { FORCE_PROMPT_CACHING_5M: "1" }))).toBe("5m");
  expect(getCacheTTL(signals({ rateLimits: [] }, { CLAUDE_CODE_PROMPT_CACHE_TTL: "1h" }))).toBe(
    "1h",
  );
  expect(getCacheTTL(signals({ setting: "5m" }))).toBe("5m");
  expect(getCacheTTL(signals({ rateLimits: [] }, { ENABLE_PROMPT_CACHING_1H: "true" }))).toBe("1h");
});

test("an observation holds until the limit state changes", async () => {
  const observed = { ttl: "1h", isOverLimit: true } satisfies CacheSignals["observed"];
  expect(getCacheTTL(signals({ rateLimits: OVER, observed }))).toBe("1h");
  expect(getCacheTTL(signals({ rateLimits: [], observed }))).toBe("1h");
  expect(getCacheTTL(signals({ observed: { ttl: "5m", isOverLimit: true } }))).toBe("1h");
});

test("a resume gap between 5m and 1h tells the lifetime", async () => {
  expect(ttlFromResume(10 * MINUTE, false)).toBe("1h");
  expect(ttlFromResume(10 * MINUTE, true)).toBe("5m");
  expect(ttlFromResume(2 * MINUTE, false)).toBeUndefined();
  expect(ttlFromResume(120 * MINUTE, true)).toBeUndefined();
});

test("only a cache hit after 5m proves 1h", async () => {
  expect(provesOneHour(10 * MINUTE, 9_500, 10_000)).toBe(true);
  expect(provesOneHour(10 * MINUTE, 0, 10_000)).toBe(false);
  expect(provesOneHour(2 * MINUTE, 10_000, 10_000)).toBe(false);
  expect(provesOneHour(10 * MINUTE, 10_000, 0)).toBe(false);
});
