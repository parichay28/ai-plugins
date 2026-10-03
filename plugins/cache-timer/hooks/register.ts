import type { EngineInterface, Register } from "claude-code";
import {
  getCacheTTL,
  isOverLimit,
  provesOneHour,
  TTL_MS,
  ttlFromResume,
  type Observed,
} from "./utils";

// Writes `<request ms> <ttl ms>` to ~/.claude/cache-timer/<session id> on each
// main-thread request; the status line reads it.

function field(record: unknown, key: string): unknown {
  if (typeof record !== "object" || record === null) return undefined;
  return Object.entries(record).find(([name]) => name === key)?.[1];
}

async function currentTTL($: EngineInterface, observed: Observed | undefined) {
  const settings = await $.settings.read();
  const vars: Record<string, string | undefined> = {
    FORCE_PROMPT_CACHING_5M: await $.env.get("FORCE_PROMPT_CACHING_5M"),
    CLAUDE_CODE_PROMPT_CACHE_TTL: await $.env.get("CLAUDE_CODE_PROMPT_CACHE_TTL"),
    ENABLE_PROMPT_CACHING_1H: await $.env.get("ENABLE_PROMPT_CACHING_1H"),
    CLAUDE_CODE_USE_BEDROCK: await $.env.get("CLAUDE_CODE_USE_BEDROCK"),
    ENABLE_PROMPT_CACHING_1H_BEDROCK: await $.env.get("ENABLE_PROMPT_CACHING_1H_BEDROCK"),
  };
  const { rateLimits } = await $.session.usage();
  const ttl = getCacheTTL({
    // The settings `env` block counts too, in case it isn't in the process env.
    env: (name) => {
      const fromSettings = field(settings.env, name);
      return vars[name] ?? (typeof fromSettings === "string" ? fromSettings : undefined);
    },
    setting: settings.promptCacheTtl,
    rateLimits,
    observed,
  });
  return { ttl, isOverLimit: isOverLimit(rateLimits) };
}

async function writeTimer($: EngineInterface, startMs: number, ttlMs: number) {
  const home = await $.env.get("HOME");
  if (home === undefined) return;
  const id = await $.session.id();
  await $.fs.write(`${home}/.claude/cache-timer/${id}`, `${startMs} ${ttlMs}\n`);
}

export const register: Register = (on) => {
  let observed: Observed | undefined;
  let lastStart: number | undefined;
  let lastPrompt = 0;

  // Subagents have their own cache.
  on("turn.step", async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e);

    const start = await $.clock.now();
    const before = await currentTTL($, observed);
    await writeTimer($, start, TTL_MS[before.ttl]);

    const result = yield* next(e);

    const usage = result.usage;
    if (usage !== null) {
      const gap = lastStart === undefined ? 0 : start - lastStart;
      if (provesOneHour(gap, usage.cache_read_input_tokens, lastPrompt)) {
        observed = { ttl: "1h", isOverLimit: before.isOverLimit };
      }
      lastPrompt =
        usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens;
    }
    lastStart = start;

    // The response brings fresh rate limits, which can change the answer.
    const after = await currentTTL($, observed);
    if (after.ttl !== before.ttl) await writeTimer($, start, TTL_MS[after.ttl]);
    return result;
  });

  // A resumed session's cache started at its last response, not now.
  on("classic.SessionStart", async ($, e, next) => {
    const seconds = e.seconds_since_last_response;
    if ((e.source === "resume" || e.source === "fork") && seconds !== undefined) {
      const gap = seconds * 1000;
      const ttl = ttlFromResume(gap, e.prompt_cache_likely_expired === true);
      if (ttl !== undefined) observed = { ttl, isOverLimit: false };
      const start = (await $.clock.now()) - gap;
      const current = await currentTTL($, observed);
      await writeTimer($, start, TTL_MS[current.ttl]);
      lastStart = start;
    }
    return next(e);
  });
};
