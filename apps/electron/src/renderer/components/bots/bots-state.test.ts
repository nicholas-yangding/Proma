import { describe, expect, test } from 'bun:test'
import type { BotConversationState, BotsSnapshot } from '@proma/shared'
import { applyBotConversation, getBotInteractionTargets, getBotReadableThroughSeq, getBotsWorkspaceSessionId, mergeBotFileReferences, mergeBotsSnapshot, summarizeBotConversation, upsertBotSummary } from './bots-state'

function conversation(id: string, revision = 1): BotConversationState {
  return {
    version: 1, revision,
    conversation: { id, kind: 'direct', botId: 'research', title: id, workspaceId: 'project', readThroughSeq: 0, createdAt: 1, updatedAt: revision },
    messages: [], bindings: [{ botId: 'research', sessionId: `${id}-pi`, membershipStartedAfterSeq: 0, consumedThroughSeq: 0 }],
    runs: [], pending: [], acceptedRequestIds: [],
  }
}

describe('Bots 公共聊天投影', () => {
  test('Given 文件区和拖拽添加同一路径，When 合并待发送引用，Then 保留一个可移除的引用和独立文件', () => {
    const first = { path: '/project/proof.md', name: 'proof.md', isDirectory: false }
    const second = { path: '/project/data', name: 'data', isDirectory: true }
    expect(mergeBotFileReferences([first], [first, second])).toEqual([first, second])
    expect(mergeBotFileReferences([], [])).toEqual([])
  })
  test('当两个聊天并行返回结果时，各自保留独立消息和运行身份', () => {
    const first = conversation('first')
    const second = conversation('second')
    first.messages.push({ id: 'first-result', seq: 1, sender: { kind: 'bot', botId: 'research', name: '研究员', avatar: '研' }, text: '第一个结果', createdAt: 1, runId: 'first-run', mentionedBotIds: [] })
    second.messages.push({ id: 'second-result', seq: 1, sender: { kind: 'bot', botId: 'research', name: '研究员', avatar: '研' }, text: '第二个结果', createdAt: 1, runId: 'second-run', mentionedBotIds: [] })
    const states = applyBotConversation(applyBotConversation(new Map(), first), second)
    expect(states.get('first')?.messages[0]?.runId).toBe('first-run')
    expect(states.get('second')?.messages[0]?.text).toBe('第二个结果')
  })

  test('当完成后收到旧流式快照时，不覆盖已完成的公开消息', () => {
    const final = conversation('topic', 4)
    final.messages.push({ id: 'reply', seq: 1, sender: { kind: 'bot', botId: 'research', name: '研究员', avatar: '研' }, text: '完整结果', createdAt: 1, mentionedBotIds: [] })
    const stale = conversation('topic', 3)
    const states = applyBotConversation(new Map([['topic', final]]), stale)
    expect(states.get('topic')?.messages[0]?.text).toBe('完整结果')
    expect(states.get('topic')?.revision).toBe(4)
  })

  test('当用户读取聊天后，未读只计算之后的 Bot 发言', () => {
    const state = conversation('topic')
    state.conversation.readThroughSeq = 1
    state.messages = [
      { id: 'old', seq: 1, sender: { kind: 'bot', botId: 'research', name: '研究员', avatar: '研' }, text: '旧结果', createdAt: 1, mentionedBotIds: [] },
      { id: 'user', seq: 2, sender: { kind: 'user' }, text: '补充', createdAt: 2, mentionedBotIds: [] },
      { id: 'new', seq: 3, sender: { kind: 'bot', botId: 'research', name: '研究员', avatar: '研' }, text: '新结果', createdAt: 3, mentionedBotIds: [] },
    ]
    expect(summarizeBotConversation(state).unreadCount).toBe(1)
    expect(summarizeBotConversation(state).preview).toBe('新结果')
  })

  test('当列表加载期间收到新聊天事件时，列表仍保留该聊天', () => {
    const state = conversation('event-created', 2)
    const snapshot: BotsSnapshot = { bots: [], conversations: [] }
    expect(mergeBotsSnapshot(snapshot, new Map([[state.conversation.id, state]])).conversations[0]?.conversation.id).toBe('event-created')
  })

  test('当群成员重新加入时，默认文件区使用当前成员身份的新 Session', () => {
    const state = conversation('group')
    state.conversation = { id: 'group', kind: 'group', title: '研发', workspaceId: 'project', readThroughSeq: 0, createdAt: 1, updatedAt: 2, instructions: '', responder: { kind: 'mentions' }, members: [{ botId: 'research', joinedAfterSeq: 0, leftAfterSeq: 3 }, { botId: 'research', joinedAfterSeq: 4 }] }
    state.bindings.push({ botId: 'research', sessionId: 'new-membership-pi', membershipStartedAfterSeq: 4, consumedThroughSeq: 4 })
    expect(getBotsWorkspaceSessionId(state, 'research')).toBe('new-membership-pi')
    expect(getBotsWorkspaceSessionId(state, 'research', 'unrelated-pi')).toBe('new-membership-pi')
    expect(getBotsWorkspaceSessionId(state, 'research', 'group-pi')).toBe('group-pi')
  })

  test('当流式占位消息出现时，不提前确认其已读，完成后才推进连续游标', () => {
    const state = conversation('streaming')
    state.messages = [
      { id: 'request', seq: 1, sender: { kind: 'user' }, text: '开始', createdAt: 1, mentionedBotIds: [] },
      { id: 'reply', seq: 2, sender: { kind: 'bot', botId: 'research', name: '研究员', avatar: '研' }, text: '', runId: 'run', createdAt: 2, mentionedBotIds: [] },
    ]
    state.runs = [{ id: 'run', roundId: 'round', botId: 'research', sessionId: 'pi', inputThroughSeq: 1, outputMessageId: 'reply', reason: 'user', state: { kind: 'running', startedAt: 1 } }]
    expect(summarizeBotConversation(state).unreadCount).toBe(0)
    expect(getBotReadableThroughSeq(state)).toBe(1)
    state.conversation.readThroughSeq = getBotReadableThroughSeq(state)
    const message = state.messages[1]
    const run = state.runs[0]
    if (!message || !run) throw new Error('测试数据缺失')
    message.text = '后台完成的结果'
    run.state = { kind: 'completed', finishedAt: 3 }
    expect(summarizeBotConversation(state).unreadCount).toBe(1)
    expect(getBotReadableThroughSeq(state)).toBe(2)
    state.conversation.readThroughSeq = getBotReadableThroughSeq(state)
    expect(summarizeBotConversation(state).unreadCount).toBe(0)
  })

  test('当其他聊天出现流式事件时，不覆盖刚刷新过的未读摘要', () => {
    const old = conversation('other')
    const incoming = conversation('active', 2)
    const authoritative = summarizeBotConversation(old)
    authoritative.unreadCount = 7
    const snapshot = upsertBotSummary({ bots: [], conversations: [authoritative] }, incoming)
    expect(snapshot.conversations.find((item) => item.conversation.id === 'other')?.unreadCount).toBe(7)
  })

  test('当同一成员同时有授权和问题时，只提供一种交互，结束的任务不挂横幅', () => {
    const state = conversation('topic')
    state.runs = [{ id: 'run', roundId: 'round', botId: 'research', sessionId: 'topic-pi', inputThroughSeq: 0, outputMessageId: 'reply', reason: 'user', state: { kind: 'running', startedAt: 1 } }]
    const pending = new Map([['topic-pi', ['request']]])
    expect(getBotInteractionTargets(state, pending, pending, pending)).toEqual([{ botId: 'research', sessionId: 'topic-pi', kind: 'permission' }])
    expect(getBotInteractionTargets(state, new Map(), pending, pending)[0]?.kind).toBe('question')
    const run = state.runs[0]
    if (!run) throw new Error('测试数据缺失')
    run.state = { kind: 'cancelled', finishedAt: 2 }
    expect(getBotInteractionTargets(state, pending, pending, pending)).toEqual([])
  })
})
