import type { EngineInterface, Register } from 'claude-code'

// Before each main-thread model request, records `<request time ms> <ttl ms>`
// in ~/.claude/cache-timer/<session id>. The status line script reads that
// file to draw the countdown.

const TTL_MS = { '5m': 5 * 60_000, '1h': 60 * 60_000 }

async function recordRequest($: EngineInterface, ttlMs: number) {
  const home = await $.env.get('HOME')
  if (home === undefined) return

  const now = await $.clock.now()
  const id = await $.session.id()
  await $.fs.write(`${home}/.claude/cache-timer/${id}`, `${now} ${ttlMs}\n`)
}

export const register: Register = (on, options) => {
  const ttlMs = options.ttl === '1h' ? TTL_MS['1h'] : TTL_MS['5m']

  // Subagents run on their own cache, so only main-thread requests count.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) await recordRequest($, ttlMs)

    return yield* next(e)
  })
}
