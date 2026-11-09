import { describe, expect, test } from 'bun:test'
import type { AgentStreamPayload, SDKAssistantMessage } from '@proma/shared'
import { createBotStreamProjection, extractNewBotReply } from './bots-runtime'
import type { BotTurnEvent } from './bots-runtime'

function assistant(uuid: string, content: string): SDKAssistantMessage {
  return { type: 'assistant', uuid, parent_tool_use_id: null, message: { content: [{ type: 'text', text: content }] } }
}

describe('Bot 真实运行消息投影', () => {
  test('Given completion 返回全历史，When 提取本轮回复，Then 不重新公开旧回复与中间说明', () => {
    const history = [assistant('old', '旧回复'), assistant('progress', '开始检查'), assistant('final', '核实后的结果')]
    expect(extractNewBotReply(history, new Set(['old']))).toBe('核实后的结果')
    expect(extractNewBotReply(history, new Set(history.map((message) => message.uuid!)))).toBe('')
  })

  test('Given 历史回放、工具子任务和失败消息，When 本轮没有公开回复，Then 不公开私有内容或旧消息', () => {
    const history: SDKAssistantMessage[] = [
      assistant('old', '旧回复'),
      { ...assistant('replay', '历史回放'), isReplay: true },
      { ...assistant('child', '子任务私有内容'), parent_tool_use_id: 'tool' },
      { ...assistant('failed', '错误响应'), error: { message: '模型失败' } },
    ]
    expect(extractNewBotReply(history, new Set(['old']))).toBe('')
  })

  test('Given 原生 delta 后又收到 final，When 投影文本，Then final 不会重复追加', () => {
    const events: BotTurnEvent[] = []
    const project = createBotStreamProjection((event) => events.push(event))
    project({ kind: 'sdk_delta', delta: { uuid: 'reply', deltas: [{ type: 'text_delta', contentIndex: 0, delta: '你' }] } })
    project({ kind: 'sdk_delta', delta: { uuid: 'reply', deltas: [{ type: 'text_delta', contentIndex: 0, delta: '好' }] } })
    project({ kind: 'sdk_message', message: { type: 'assistant', uuid: 'reply', parent_tool_use_id: null, message: { content: [{ type: 'text', text: '你好' }] } } })
    expect(events.filter((event) => event.kind === 'text').map((event) => event.text)).toEqual(['你', '你好'])
  })

  test('Given 思考和工具事件，When 发布运行状态，Then 不把思考与工具参数广播为公共聊天', () => {
    const events: BotTurnEvent[] = []
    const project = createBotStreamProjection((event) => events.push(event))
    const payload: AgentStreamPayload = { kind: 'sdk_delta', delta: { uuid: 'reply', deltas: [
      { type: 'thinking_start', contentIndex: 0 },
      { type: 'thinking_delta', contentIndex: 0, delta: '私有推理' },
      { type: 'toolcall_start', contentIndex: 1, toolCall: { id: 'tool', name: 'Read', arguments: { path: 'private.txt' } } },
    ] } }
    project(payload)
    expect(events.some((event) => event.kind === 'activity')).toBe(true)
    expect(events.some((event) => event.kind === 'text')).toBe(false)
    expect(JSON.stringify(events)).not.toContain('私有推理')
    expect(JSON.stringify(events)).not.toContain('private.txt')
  })
})
