# Plan: `cache-timer` mod

A mod that shows how long is left before the prompt cache from the last model request expires. Built and in use on 2026-10-03; this plan records what v0.1.0 is and why.

## Why it exists

Coming back to a session after the prompt cache expired makes the next request pay to write the whole conversation into the cache again. Without a timer you can't tell whether you're inside the 5-minute (or 1-hour) window.

## v0.1.0

### Layout

```
plugins/cache-timer/
├── .claude-plugin/plugin.json   # version 0.2.0
├── hooks/
│   ├── hooks.json               # { "modules": ["./register.ts"] }
│   ├── register.ts              # the hooks module
│   └── register.test.ts         # file written per request, subagents skipped, TTL option
├── tsconfig.json                # extends the engine-generated types (gitignored)
└── README.md                    # how it works + status line snippet
```

### Behaviour

- `turn.step` on the main thread (no `agentId`): write `<ms> <ttlMs>` to `~/.claude/cache-timer/<session id>`.
- No timers, no notifications, no `$.state`: the file is the only state, and the mod does nothing between requests.
- The countdown is drawn by the user's status line script, not the mod, so it sits next to the cached-token count instead of on its own line. The script re-runs every second via `statusLine.refreshInterval`.

### Registration

- Entry in `.claude-plugin/marketplace.json`.
- Validate: `claude plugin validate . && claude plugin validate plugins/cache-timer && claude plugin test plugins/cache-timer`.

## v0.2.0: detect the cache lifetime

v0.1.0 asked the user for the lifetime. Claude Code picks it per request, so a fixed option is wrong for some sessions. v0.2.0 works it out the way Claude Code does (`aoe`/`RWt` in the CLI bundle) and drops the option.

`getCacheTTL` in `hooks/utils.ts`, first match wins:

1. `FORCE_PROMPT_CACHING_5M` → 5m.
2. `CLAUDE_CODE_PROMPT_CACHE_TTL` (`5m` | `1h`).
3. `promptCacheTtl` setting.
4. `ENABLE_PROMPT_CACHING_1H`, or `ENABLE_PROMPT_CACHING_1H_BEDROCK` on Bedrock → 1h.
5. No rate-limit windows (not a subscriber) → 5m.
6. An observed lifetime, while the over-limit state it was seen under still holds.
7. A `five_hour` or `seven_day` window at 100% or more (overage) → 5m, else 1h.

Env values come from `$.env.get`, falling back to the settings `env` block.

Observations:

- Resume or fork: `classic.SessionStart` gives `seconds_since_last_response` and `prompt_cache_likely_expired`. A gap of 5–60 minutes tells Claude Code's lifetime. Rewrite the file dated to the last response, since a fork has a new session id and the old file may carry the wrong lifetime.
- Each main request: if it started 5–60 minutes after the previous one and read at least 90% of the previous prompt from the cache, the lifetime is 1h. A miss proves nothing (model switch, compaction, eviction, the shared system-prompt cache).

The file is written when a request starts and rewritten with the same start time once it finishes, since the rate-limit windows only arrive with the first reply.

## Later

- Optional built-in display (`$.ui.status`) for people without a custom status line script.
- Clean up old files in `~/.claude/cache-timer/` (the hooks API has no file delete yet).
