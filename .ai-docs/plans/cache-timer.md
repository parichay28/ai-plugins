# Plan: `cache-timer` mod

A mod that shows how long is left before the prompt cache from the last model request expires. Built and in use on 2026-10-03; this plan records what v0.1.0 is and why.

## Why it exists

Coming back to a session after the prompt cache expired makes the next request pay to write the whole conversation into the cache again. Without a timer you can't tell whether you're inside the 5-minute (or 1-hour) window.

## v0.1.0

### Layout

```
plugins/cache-timer/
├── .claude-plugin/plugin.json   # version 0.1.0, `userConfig.ttl` (5m | 1h)
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

## Later

- Optional built-in display (`$.ui.status`) for people without a custom status line script.
- Clean up old files in `~/.claude/cache-timer/` (the hooks API has no file delete yet).
