# cache-timer

A Claude Code mod that shows how long is left before the prompt cache goes cold.

## Background

Claude Code sends the whole conversation with every model request. The API keeps a cached copy of that prefix, so the next request reads it cheaply instead of paying full price to process it again. The cached copy only lives for a fixed time after the last request that used it: 5 minutes by default, or 1 hour with the longer cache. If you come back after it expired, the next request pays to write the whole prefix into the cache again.

This mod tells you how much of that time is left.

## How it works

The mod and your status line script split the job.

1. **The mod notices each request.** It hooks `turn.step`, the event Claude Code raises right before each model request. Requests made by subagents are skipped, since they don't use the main conversation's cache.
2. **The mod writes down when it happened.** It writes one line, `<last request time in ms> <cache lifetime in ms>`, to `~/.claude/cache-timer/<session id>`.
3. **The status line does the countdown.** Your status line script gets the session id in its JSON input, reads that file, and prints the time remaining. With `refreshInterval` set, it re-runs every second, so the timer ticks even while the session is idle.

The mod doesn't draw the countdown itself because a mod's status entry appears on its own line above the status line. Drawing it from the script puts it right next to the cached-token count.

### Which lifetime it counts down from

Claude Code picks the cache lifetime per request, and the API response doesn't say which one it used. The mod infers it from the rules Claude Code applies:

- `FORCE_PROMPT_CACHING_5M`, `CLAUDE_CODE_PROMPT_CACHE_TTL` or `promptCacheTtl` in settings win if you've set them. So do `ENABLE_PROMPT_CACHING_1H` and its Bedrock version.
- On a subscription, the main conversation gets 1 hour.
- Once you're past your plan's limit and running on extra usage, it drops to 5 minutes. Mods can't see this directly, so the mod takes a usage window at 100% as the sign.
- With an API key, it's 5 minutes.

The mod only knows you're on a subscription once a response has reported your usage limits. Until then it assumes 5 minutes, and it corrects the line as soon as the first response comes in.

The cache itself can also confirm the answer. If a request more than 5 minutes after the last one still reads almost everything from the cache, the lifetime must be 1 hour, and the mod remembers that.

Resumed sessions start the countdown from the last response in the transcript, not from when you resumed. Claude Code tells the mod how long ago that was and whether it thinks the cache has expired, which also shows which lifetime was in use.

## Install

```bash
claude plugin marketplace add parichay28/ai-plugins
claude plugin install cache-timer@ai-plugins
```

### Add the countdown to your status line

Add this to your status line script, after it has read its JSON input into `$input`. It sets `$cache_timer` to a faded `(m:ss)`, which turns red under a minute and shows `(cold)` once expired.

```bash
cache_timer=""
session_id=$(echo "$input" | jq -r '.session_id // empty')
timer_file="$HOME/.claude/cache-timer/$session_id"
if [ -n "$session_id" ] && [ -f "$timer_file" ]; then
    read -r last_ms ttl_ms < "$timer_file"
    now_ms=$(( $(date +%s) * 1000 ))
    remaining=$(( (last_ms + ttl_ms - now_ms + 999) / 1000 ))
    if [ "$remaining" -gt 60 ]; then
        timer_color="\033[38;2;98;114;164m"   # faded blue-grey
    elif [ "$remaining" -gt 0 ]; then
        timer_color="\033[38;2;169;68;73m"    # faded red: under a minute left
    else
        timer_color="\033[38;2;74;81;116m"    # fainter blue-grey: expired
    fi
    if [ "$remaining" -gt 0 ]; then
        cache_timer=$(printf ' %b(%d:%02d)\033[0m' "$timer_color" $(( remaining / 60 )) $(( remaining % 60 )))
    else
        cache_timer=$(printf ' %b(cold)\033[0m' "$timer_color")
    fi
fi
```

Then print `$cache_timer` wherever you want it, and set the status line to refresh every second in `~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "bash /path/to/statusline.sh",
  "refreshInterval": 1
}
```

## Develop

```bash
claude plugin validate plugins/cache-timer
claude plugin test plugins/cache-timer
```
