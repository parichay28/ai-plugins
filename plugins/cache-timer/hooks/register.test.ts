import type { On, TurnStepInput } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

const MINUTE = 60_000

function engineBeneath(on: On) {
  const writes: { path: string; text: string }[] = []

  mock.env(on, { HOME: '/home/me' })
  on('session.id', () => ({ value: 'session-1' }))
  on('fs.write', ($, e) => {
    writes.push(e)
    return { value: undefined }
  })
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })

  mock.clock(on, { now: 1_000 })

  return { writes }
}

async function step($: Engine, input: Partial<TurnStepInput> = {}) {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...input })
  for await (const _ of stream);
}

test('records each main-thread request for the status line', async ($, on) => {
  const { writes } = engineBeneath(on)

  await step($)

  expect(writes).toEqual([{ path: '/home/me/.claude/cache-timer/session-1', text: `1000 ${5 * MINUTE}\n` }])
})

test('ignores subagent requests', async ($, on) => {
  const { writes } = engineBeneath(on)

  await step($, { agentId: 'agent-1' })

  expect(writes).toEqual([])
})

test('uses the 1h TTL when configured', { options: { ttl: '1h' } }, async ($, on) => {
  const { writes } = engineBeneath(on)

  await step($)

  expect(writes[0]?.text).toBe(`1000 ${60 * MINUTE}\n`)
})

