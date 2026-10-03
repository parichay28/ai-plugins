import type { On, SessionRateLimit, Settings, TurnStepInput, TurnUsage } from "claude-code";
import type { Engine } from "claude-code/testing";
import { expect, mock, test } from "claude-code/testing";

const MINUTE = 60_000;
const FILE = "/home/me/.claude/cache-timer/session-1";
const UNDER: SessionRateLimit[] = [{ kind: "five_hour", percentUsed: 40 }];

type World = {
  settings?: Settings;
  // Rate limits before and after the first response.
  limits?: { before: SessionRateLimit[]; after: SessionRateLimit[] };
  usage?: TurnUsage[];
};

function setup(on: On, world: World = {}) {
  const writes: { path: string; text: string }[] = [];
  const limits = world.limits ?? { before: [], after: [] };
  const usage = world.usage ?? [];
  let rateLimits = limits.before;
  let steps = 0;

  mock.env(on, { HOME: "/home/me" });
  on("session.id", () => ({ value: "session-1" }));
  on("settings.read", () => ({ value: world.settings ?? {} }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits },
  }));
  on("fs.write", ($, e) => {
    writes.push(e);
    return { value: undefined };
  });
  // Generator that returns right away, nothing to stream.
  // oxlint-disable-next-line require-yield
  on("turn.step", async function* ($, e) {
    rateLimits = limits.after;
    steps += 1;
    return {
      turnId: e.turnId,
      index: e.index,
      answer: "",
      toolUses: [],
      stopReason: null,
      usage: usage[steps - 1] ?? null,
    };
  });

  on("classic.SessionStart", () => ({}));

  const clock = mock.clock(on, { now: 1_000 });

  return { writes, clock };
}

async function step($: Engine, input: Partial<TurnStepInput> = {}) {
  const stream = $.turn.step({
    turnId: "t1",
    index: 0,
    model: "claude-opus-5-5",
    messageCount: 1,
    ...input,
  });
  for await (const _ of stream);
}

function prompt(cacheRead: number): TurnUsage {
  return {
    model: "claude-opus-5-5",
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: 10_000 - cacheRead,
  };
}

test("API key sessions count down from 5m", async ($, on) => {
  const { writes } = setup(on);

  await step($);

  expect(writes).toEqual([{ path: FILE, text: `1000 ${5 * MINUTE}\n` }]);
});

test("ignores subagent requests", async ($, on) => {
  const { writes } = setup(on);

  await step($, { agentId: "agent-1" });

  expect(writes).toEqual([]);
});

test("switches to 1h once the first response shows a subscription", async ($, on) => {
  const { writes } = setup(on, { limits: { before: [], after: UNDER } });

  await step($);

  expect(writes.map((write) => write.text)).toEqual([
    `1000 ${5 * MINUTE}\n`,
    `1000 ${60 * MINUTE}\n`,
  ]);
});

test("extra usage counts down from 5m", async ($, on) => {
  const over = [{ kind: "seven_day", percentUsed: 100 }];
  const { writes } = setup(on, { limits: { before: over, after: over } });

  await step($);

  expect(writes).toEqual([{ path: FILE, text: `1000 ${5 * MINUTE}\n` }]);
});

test("uses the TTL from settings", async ($, on) => {
  const { writes } = setup(on, { settings: { promptCacheTtl: "1h" } });

  await step($);

  expect(writes).toEqual([{ path: FILE, text: `1000 ${60 * MINUTE}\n` }]);
});

test("a cache hit after 10 minutes proves 1h", async ($, on) => {
  const over = [{ kind: "five_hour", percentUsed: 100 }];
  const { writes, clock } = setup(on, {
    limits: { before: over, after: over },
    usage: [prompt(0), prompt(9_900)],
  });

  await step($);
  await clock.advance(10 * MINUTE);
  await step($);

  expect(writes.at(-1)?.text).toBe(`${1_000 + 10 * MINUTE} ${60 * MINUTE}\n`);
});

test("a resumed session counts from its last response", async ($, on) => {
  const { writes } = setup(on);

  await $.classic.SessionStart({
    source: "resume",
    seconds_since_last_response: 600,
    prompt_cache_likely_expired: false,
  });

  expect(writes).toEqual([{ path: FILE, text: `${1_000 - 10 * MINUTE} ${60 * MINUTE}\n` }]);
});

test("a new session waits for its first request", async ($, on) => {
  const { writes } = setup(on);

  await $.classic.SessionStart({ source: "startup" });

  expect(writes).toEqual([]);
});
