import { describe, expect, test } from 'bun:test'
import { AgentQueueCoordinator } from './agent-queue-coordinator'

describe('Agent 消息队列', () => {
  test('当本轮无法立即注入时，将用户指定立即发送的消息排到下一轮', () => {
    const queue = new AgentQueueCoordinator({
      isActive: () => true,
      getWebContents: () => null,
      startRun: async () => {},
      sendStarted: () => {},
      reserveRunGeneration: () => 1,
    })
    const input = { sessionId: 'parent', channelId: 'channel', userMessage: '任务' }
    queue.enqueue({ ...input, queueMessageId: 'earlier' })
    queue.enqueue({ ...input, queueMessageId: 'now' }, true)
    queue.enqueue({ ...input, queueMessageId: 'later' })

    expect(queue.snapshot(input.sessionId).map(({ input }) => input.queueMessageId))
      .toEqual(['now', 'earlier', 'later'])
  })
})
