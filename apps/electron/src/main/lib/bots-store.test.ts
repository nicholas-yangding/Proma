import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BotConversationState, BotDefinition, SaveBotInput } from '@proma/shared'
import { BotsStore } from './bots-store'
import {
  createBotConversationInputSchema, saveBotInputSchema, sendBotMessageInputSchema,
  stopBotRunInputSchema, updateBotConversationInputSchema,
} from './bots-validation'

let directory: string
let store: BotsStore
let now: number
let sequence: number

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'proma-bots-store-'))
  now = 1000
  sequence = 0
  store = new BotsStore({ directory, now: () => now, id: () => `id-${++sequence}` })
})

afterEach(() => rmSync(directory, { recursive: true, force: true }))

function createBot(name = '研究员'): BotDefinition {
  return store.saveBot({ name, avatar: '研', instructions: '核对来源。', model: { kind: 'default' }, defaultWorkspaceId: 'workspace-a', permissionMode: 'plan' })
}

function createDirect(botId: string): BotConversationState {
  return store.createConversation({ kind: 'direct', botId, title: '竞品调研', workspaceId: 'workspace-a' })
}

function createGroup(memberBotIds: string[]): BotConversationState {
  return store.createConversation({ kind: 'group', memberBotIds, title: '研发群', workspaceId: 'workspace-a', responder: { kind: 'mentions' }, instructions: '结论附依据。' })
}

function startRun(conversationId: string, bot: BotDefinition): BotConversationState {
  return store.transact(conversationId, (draft) => {
    draft.messages.push({ id: 'user-1', seq: 1, sender: { kind: 'user' }, text: '请调研', createdAt: now, mentionedBotIds: [] })
    draft.messages.push({ id: 'reply-1', seq: 2, sender: { kind: 'bot', botId: bot.id, name: bot.name, avatar: bot.avatar }, text: '正在整理', createdAt: now, mentionedBotIds: [], runId: 'run-1', sessionId: 'session-1' })
    draft.bindings.push({ botId: bot.id, sessionId: 'session-1', membershipStartedAfterSeq: 0, consumedThroughSeq: 0 })
    draft.runs.push({ id: 'run-1', roundId: 'round-1', botId: bot.id, sessionId: 'session-1', inputThroughSeq: 1, outputMessageId: 'reply-1', reason: 'user', state: { kind: 'running', startedAt: now }, activity: '读取资料' })
    draft.acceptedRequestIds.push('request-1')
  })
}

describe('Bots 持久聊天', () => {
  test('Given 长期 Bot 与独立私聊 When 保存后重启 Then 配置和不同话题均保留', () => {
    const bot = createBot()
    const first = createDirect(bot.id)
    const second = store.createConversation({ kind: 'direct', botId: bot.id, title: '客户访谈', workspaceId: 'workspace-a' })
    const reloaded = new BotsStore({ directory })
    expect(reloaded.getBot(bot.id)).toEqual(bot)
    expect(reloaded.list().conversations.map((item) => item.conversation.id).sort()).toEqual([first.conversation.id, second.conversation.id].sort())
    expect(reloaded.get(first.conversation.id).conversation.title).toBe('竞品调研')
    expect(reloaded.get(second.conversation.id).conversation.title).toBe('客户访谈')
  })

  test('Given 已保存快照 When 调用方修改返回值 Then 不会绕过事务改变聊天', () => {
    const bot = createBot()
    const state = createDirect(bot.id)
    state.conversation.title = '未保存'
    const loaded = store.get(state.conversation.id)
    loaded.acceptedRequestIds.push('not-persisted')
    const listed = store.list()
    listed.bots[0]!.name = '未保存'
    expect(store.get(state.conversation.id).conversation.title).toBe('竞品调研')
    expect(store.get(state.conversation.id).acceptedRequestIds).toEqual([])
    expect(store.getBot(bot.id).name).toBe('研究员')
  })

  test('Given 完成消息和游标 When 一次事务保存 Then 重启读取到一致的消息与运行终态', () => {
    const bot = createBot()
    const state = createDirect(bot.id)
    startRun(state.conversation.id, bot)
    store.transact(state.conversation.id, (draft) => {
      draft.messages[1]!.text = '调研完成'
      draft.runs[0]!.state = { kind: 'completed', finishedAt: 1100 }
      draft.bindings[0]!.consumedThroughSeq = 1
    })
    const loaded = new BotsStore({ directory }).get(state.conversation.id)
    expect(loaded.messages[1]!.text).toBe('调研完成')
    expect(loaded.runs[0]!.state.kind).toBe('completed')
    expect(loaded.bindings[0]!.consumedThroughSeq).toBe(1)
    expect(loaded.acceptedRequestIds).toEqual(['request-1'])
    expect(loaded.revision).toBe(2)
  })

  test('Given 非法重复请求或消息 When 提交事务 Then 磁盘和缓存保留原快照', () => {
    const state = createDirect(createBot().id)
    const path = join(directory, 'conversations', `${state.conversation.id}.json`)
    const before = readFileSync(path, 'utf8')
    expect(() => store.transact(state.conversation.id, (draft) => { draft.acceptedRequestIds.push('same', 'same') })).toThrow()
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(store.get(state.conversation.id)).toEqual(state)
    expect(() => store.transact(state.conversation.id, (draft) => { draft.conversation.id = 'another' })).toThrow()
    expect(store.get(state.conversation.id)).toEqual(state)
  })

  test('Given 已有 Bot 发言 When 归档 Bot Then 保留身份快照和聊天且拒绝新聊天', () => {
    const bot = createBot()
    const state = createDirect(bot.id)
    store.transact(state.conversation.id, (draft) => {
      draft.messages.push({ id: 'history', seq: 1, sender: { kind: 'bot', botId: bot.id, name: bot.name, avatar: bot.avatar }, text: '历史结论', createdAt: now, mentionedBotIds: [] })
    })
    store.archiveBot(bot.id)
    expect(store.getBot(bot.id).archivedAt).toBe(now)
    expect(store.get(state.conversation.id).messages[0]!.text).toBe('历史结论')
    expect(store.get(state.conversation.id).messages[0]!.sender).toEqual({ kind: 'bot', botId: bot.id, name: '研究员', avatar: '研' })
    expect(() => createDirect(bot.id)).toThrow('归档')
    expect(() => store.saveBot({ id: bot.id, name: '修改', avatar: bot.avatar, instructions: bot.instructions, model: bot.model, defaultWorkspaceId: bot.defaultWorkspaceId, permissionMode: bot.permissionMode })).toThrow('归档')
    expect(new BotsStore({ directory }).get(state.conversation.id).messages).toHaveLength(1)
  })

  test('Given Bot 正在运行 When 归档 Bot 或变更群成员 Then 拒绝并保持原记录', () => {
    const bot = createBot()
    const second = createBot('工程师')
    const state = createGroup([bot.id, second.id])
    startRun(state.conversation.id, bot)
    expect(() => store.archiveBot(bot.id)).toThrow('工作')
    expect(() => store.updateConversation({ conversationId: state.conversation.id, memberBotIds: [second.id] })).toThrow('工作')
    expect(() => store.updateConversation({ conversationId: state.conversation.id, archived: true })).toThrow('工作')
    expect(store.getBot(bot.id).archivedAt).toBeUndefined()
    expect(store.updateConversation({ conversationId: state.conversation.id, title: '允许改标题' }).conversation.title).toBe('允许改标题')
  })

  test('Given 成员离开后重新加入 When 更新群 Then 新 membership epoch 不会复用旧上下文位置', () => {
    const bot = createBot()
    const second = createBot('工程师')
    const state = createGroup([bot.id, second.id])
    store.transact(state.conversation.id, (draft) => { draft.bindings.push({ botId: bot.id, sessionId: 'old-session', membershipStartedAfterSeq: 0, consumedThroughSeq: 0 }) })
    store.updateConversation({ conversationId: state.conversation.id, memberBotIds: [second.id] })
    const rejoined = store.updateConversation({ conversationId: state.conversation.id, memberBotIds: [second.id, bot.id] })
    expect(rejoined.conversation.kind).toBe('group')
    if (rejoined.conversation.kind !== 'group') throw new Error('群类型错误')
    const memberships = rejoined.conversation.members.filter((member) => member.botId === bot.id)
    expect(memberships).toEqual([{ botId: bot.id, joinedAfterSeq: 0, leftAfterSeq: 1 }, { botId: bot.id, joinedAfterSeq: 2 }])
    expect(rejoined.bindings[0]!.membershipStartedAfterSeq).toBe(0)
    expect(rejoined.messages.map((message) => message.seq)).toEqual([1, 2])
    expect(new BotsStore({ directory }).get(state.conversation.id).conversation).toEqual(rejoined.conversation)
  })

  test('Given 被移出的负责人 When 未指定新负责人 Then 群改为仅提及回应', () => {
    const bot = createBot()
    const second = createBot('工程师')
    const group = store.createConversation({ kind: 'group', memberBotIds: [bot.id, second.id], title: '研发群', workspaceId: 'workspace-a', responder: { kind: 'member', botId: bot.id }, instructions: '' })
    const updated = store.updateConversation({ conversationId: group.conversation.id, memberBotIds: [second.id] })
    expect(updated.conversation.kind === 'group' && updated.conversation.responder).toEqual({ kind: 'mentions' })
    expect(() => store.updateConversation({ conversationId: group.conversation.id, responder: { kind: 'member', botId: bot.id } })).toThrow('负责人')
  })

  test('Given 中断运行及排队用户输入 When 恢复 Then 保存文字并标中断且不会重放', () => {
    const bot = createBot()
    const state = createDirect(bot.id)
    startRun(state.conversation.id, bot)
    store.transact(state.conversation.id, (draft) => {
      draft.pending.push({ requestId: 'queued-1', text: '稍后继续检查', mentionedBotIds: [], queuedAt: 1050 })
      draft.acceptedRequestIds.push('queued-1')
    })
    const restarted = new BotsStore({ directory, now: () => 2000, id: () => 'recovery-notice' })
    expect(restarted.recoverInterrupted()).toHaveLength(1)
    const recovered = restarted.get(state.conversation.id)
    expect(recovered.runs[0]!.state).toEqual({ kind: 'interrupted', finishedAt: 2000 })
    expect(recovered.pending).toEqual([])
    expect(recovered.messages.map((message) => message.text)).toEqual(['请调研', '正在整理', '稍后继续检查', '上次工作已中断，已有内容已保留。请重新发送消息以继续。'])
    expect(restarted.recoverInterrupted()).toEqual([])
    expect(new BotsStore({ directory }).get(state.conversation.id)).toEqual(recovered)
  })

  test('Given 未读 Bot 回复 When 标记已读 Then 读位置单调且其他聊天不变', () => {
    const bot = createBot()
    const first = createDirect(bot.id)
    const second = createDirect(bot.id)
    startRun(first.conversation.id, bot)
    expect(store.list().conversations.find((item) => item.conversation.id === first.conversation.id)!.unreadCount).toBe(1)
    now = 3000
    expect(store.markRead(first.conversation.id, 999).conversation.readThroughSeq).toBe(2)
    expect(store.get(first.conversation.id).conversation.updatedAt).toBe(1000)
    expect(store.markRead(first.conversation.id, 0).conversation.readThroughSeq).toBe(2)
    expect(store.get(second.conversation.id).conversation.readThroughSeq).toBe(0)
    expect(store.list().conversations.find((item) => item.conversation.id === first.conversation.id)!.unreadCount).toBe(0)
    expect(() => store.markRead(first.conversation.id, -1)).toThrow()
  })

  test('Given 主文件写坏但有备份 When 重启 Then 使用已有备份恢复', () => {
    const state = createDirect(createBot().id)
    store.updateConversation({ conversationId: state.conversation.id, title: '较新标题' })
    const path = join(directory, 'conversations', `${state.conversation.id}.json`)
    writeFileSync(path, '{broken')
    expect(new BotsStore({ directory }).get(state.conversation.id).conversation.title).toBe('竞品调研')
  })

  test('Given 唯一聊天记录损坏 When 重启 Then 报错且不以空数据覆盖原文件', () => {
    const state = createDirect(createBot().id)
    const path = join(directory, 'conversations', `${state.conversation.id}.json`)
    writeFileSync(path, '{broken')
    expect(() => new BotsStore({ directory })).toThrow('无法恢复')
    expect(readFileSync(path, 'utf8')).toBe('{broken')
  })

  test('Given 结构损坏或重复 Bot ID When 加载 Then 拒绝无效磁盘记录', () => {
    const bot = createBot()
    const definitionsPath = join(directory, 'definitions.json')
    writeFileSync(definitionsPath, JSON.stringify({ version: 1, bots: [bot, bot] }))
    expect(() => new BotsStore({ directory })).toThrow()
  })

  test('Given 磁盘路径和创建 ID 冲突 When 读取或创建 Then 拒绝路径穿越及覆盖', () => {
    const bot = createBot()
    expect(() => store.get('../outside')).toThrow()
    const duplicate = new BotsStore({ directory, id: () => bot.id })
    const input: SaveBotInput = { name: '重复', avatar: '', instructions: '', model: { kind: 'default' }, defaultWorkspaceId: 'workspace-a', permissionMode: 'plan' }
    expect(() => duplicate.saveBot(input)).toThrow('已存在')
    expect(duplicate.list().bots).toHaveLength(1)
  })
})

describe('Bots IPC 输入验证', () => {
  test('Given 默认项目空值 When 解析创建输入 Then 允许主进程解析默认项目但拒绝额外执行字段', () => {
    expect(saveBotInputSchema.parse({ name: '研究员', avatar: '', instructions: '', model: { kind: 'default' }, defaultWorkspaceId: '', permissionMode: 'plan' }).defaultWorkspaceId).toBe('')
    expect(createBotConversationInputSchema.parse({ kind: 'direct', botId: 'bot-1', title: '新话题', workspaceId: '' }).workspaceId).toBe('')
    expect(() => saveBotInputSchema.parse({ name: '研究员', avatar: '', instructions: '', model: { kind: 'default' }, defaultWorkspaceId: '', permissionMode: 'plan', systemPromptAppend: 'forged' })).toThrow()
  })

  test('Given 非法群成员或空消息 When 解析输入 Then 拒绝重复成员和无效标识', () => {
    expect(() => createBotConversationInputSchema.parse({ kind: 'group', memberBotIds: ['bot-1', 'bot-1'], title: '群', workspaceId: '', responder: { kind: 'mentions' }, instructions: '' })).toThrow()
    expect(() => sendBotMessageInputSchema.parse({ conversationId: 'room-1', requestId: 'request-1', text: '  ', mentionedBotIds: [] })).toThrow()
    expect(() => stopBotRunInputSchema.parse({ conversationId: '../room' })).toThrow()
    expect(() => updateBotConversationInputSchema.parse({ conversationId: 'room-1', workspaceId: 'other' })).toThrow()
  })
})
