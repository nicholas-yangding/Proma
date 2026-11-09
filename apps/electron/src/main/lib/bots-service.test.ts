import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BotConversationState, BotDefinition, BotResponder } from '@proma/shared'
import { BotsService } from './bots-service'
import { BotsStore } from './bots-store'
import type { BotRuntime, BotTurnEvent, BotTurnInput, BotTurnResult } from './bots-runtime'

interface RecordedTurn {
  input: BotTurnInput
  emit: (event: BotTurnEvent) => void
  complete: (result: BotTurnResult) => void
}

class ControlledRuntime implements BotRuntime {
  calls: RecordedTurn[] = []
  stopped: string[] = []
  private readonly sessions = new Map<string, string>()

  ensureSession(input: Parameters<BotRuntime['ensureSession']>[0]): string {
    const key = JSON.stringify(input)
    const previous = this.sessions.get(key)
    if (previous) return previous
    const id = randomUUID()
    this.sessions.set(key, id)
    return id
  }

  run(input: BotTurnInput, emit: (event: BotTurnEvent) => void): Promise<BotTurnResult> {
    return new Promise((resolve) => { this.calls.push({ input, emit, complete: resolve }) })
  }

  stop(sessionId: string): void { this.stopped.push(sessionId) }
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('任务未在预期状态结束。')
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'proma-bots-service-'))
  const store = new BotsStore({ directory })
  const runtime = new ControlledRuntime()
  const service = new BotsService({ store, runtime })
  const workspaceId = randomUUID()
  const bot = (name: string) => service.saveBot({ name, avatar: name.slice(0, 1), instructions: `你是${name}`, model: { kind: 'default' }, defaultWorkspaceId: workspaceId, permissionMode: 'plan' })
  const group = (members: BotDefinition[], responder: BotResponder = { kind: 'mentions' }) => service.createConversation({ kind: 'group', title: '研发群', workspaceId, memberBotIds: members.map((member) => member.id), responder, instructions: '核对来源。' })
  const direct = (member: BotDefinition) => service.createConversation({ kind: 'direct', title: '长期私聊', workspaceId, botId: member.id })
  const send = (state: BotConversationState, text: string, mentionedBotIds: string[] = [], requestId = randomUUID()) => service.send({ conversationId: state.conversation.id, requestId, text, mentionedBotIds })
  cleanups.push(async () => {
    service.dispose()
    for (const call of runtime.calls) call.complete({ text: '', stopped: true })
    await new Promise((resolve) => setTimeout(resolve, 5))
    rmSync(directory, { recursive: true, force: true })
  })
  return { directory, store, runtime, service, workspaceId, bot, group, direct, send }
}

describe('Bots 持久聊天执行', () => {
  test('Given 用户明确引用文件，When 群成员执行和新成员加入，Then 引用落盘且只有可见引用授予附加目录', async () => {
    const f = fixture()
    const first = f.bot('研究员')
    const newcomer = f.bot('工程师')
    const group = f.group([first], { kind: 'everyone' })
    const files = [{ path: '/authorized/proof.md', name: 'proof.md', isDirectory: false }]
    f.service.send({ conversationId: group.conversation.id, requestId: randomUUID(), text: '检查引用文件', mentionedBotIds: [], files })
    await eventually(() => f.runtime.calls.length === 1)
    expect(f.runtime.calls[0]!.input.prompt).toContain('/authorized/proof.md')
    expect(f.runtime.calls[0]!.input.additionalDirectories).toEqual(['/authorized'])
    expect(f.service.get(group.conversation.id).messages[0]?.files).toEqual(files)
    f.runtime.calls[0]!.complete({ text: '检查完成', stopped: false })
    await eventually(() => f.service.get(group.conversation.id).runs.every((run) => run.state.kind === 'completed'))
    f.service.updateConversation({ conversationId: group.conversation.id, memberBotIds: [first.id, newcomer.id] })
    f.send(group, '继续检查')
    await eventually(() => f.runtime.calls.length === 3)
    const next = f.runtime.calls.find((call) => call.input.bot.id === newcomer.id)
    expect(next?.input.prompt).not.toContain('/authorized/proof.md')
    expect(next?.input.additionalDirectories).toEqual([])
    const reopened = new BotsStore({ directory: f.directory })
    expect(reopened.get(group.conversation.id).messages[0]?.files).toEqual(files)
  })

  test('Given 群中两位 Bot 正在执行且有排队消息，When 归档其中一位被拒绝，Then 不取消任何工作', async () => {
    const f = fixture()
    const first = f.bot('研究员')
    const second = f.bot('工程师')
    const group = f.group([first, second], { kind: 'everyone' })
    f.send(group, '检查')
    await eventually(() => f.runtime.calls.length === 2)
    f.send(group, '继续检查')
    expect(() => f.service.archiveBot(first.id)).toThrow('请先停止相关聊天')
    expect(f.runtime.stopped).toEqual([])
    expect(f.service.get(group.conversation.id).runs.every((run) => run.state.kind === 'running')).toBe(true)
    expect(f.service.get(group.conversation.id).pending).toHaveLength(1)
    expect(f.store.getBot(first.id).archivedAt).toBeUndefined()
  })

  test('Given 私聊与群聊属于同一 Bot，When 创建会话，Then 执行上下文与文件身份相互独立', () => {
    const f = fixture()
    const researcher = f.bot('研究员')
    const direct = f.direct(researcher)
    const group = f.group([researcher])
    expect(direct.bindings[0]?.sessionId).toBeDefined()
    expect(group.bindings[0]?.sessionId).toBeDefined()
    expect(direct.bindings[0]?.sessionId).not.toBe(group.bindings[0]?.sessionId)
  })

  test('Given 群中明确点名两位成员，When 真实执行边界运行，Then 分别使用自己的 Session 并公开各自结果', async () => {
    const f = fixture()
    const researcher = f.bot('研究员')
    const engineer = f.bot('工程师')
    const group = f.group([researcher, engineer])
    f.send(group, '@研究员 @工程师 分别检查', [researcher.id, engineer.id])
    await eventually(() => f.runtime.calls.length === 2)
    expect(f.runtime.calls[0]!.input.sessionId).not.toBe(f.runtime.calls[1]!.input.sessionId)
    f.runtime.calls[0]!.complete({ text: '交互结果', stopped: false })
    f.runtime.calls[1]!.complete({ text: '源码结果', stopped: false })
    await eventually(() => f.service.get(group.conversation.id).runs.every((run) => run.state.kind === 'completed'))
    const state = f.service.get(group.conversation.id)
    expect(state.messages.filter((message) => message.sender.kind === 'bot').map((message) => message.text)).toEqual(['交互结果', '源码结果'])
    expect(state.bindings.map((binding) => binding.consumedThroughSeq)).toEqual([1, 1])
  })

  test('Given 同一请求重发且新消息排队，When 第一轮尚未结束，Then 不重复派工也不提前污染公共历史', async () => {
    const f = fixture()
    const chat = f.direct(f.bot('研究员'))
    const first = randomUUID()
    f.send(chat, '第一条', [], first)
    f.send(chat, '第一条', [], first)
    await eventually(() => f.runtime.calls.length === 1)
    f.send(chat, '第二条')
    expect(f.service.get(chat.conversation.id).messages.filter((message) => message.sender.kind === 'user').map((message) => message.text)).toEqual(['第一条'])
    f.runtime.calls[0]!.emit({ kind: 'text', text: '已经输出，但运行还未释放' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(f.runtime.calls).toHaveLength(1)
    f.runtime.calls[0]!.complete({ text: '第一轮完成', stopped: false })
    await eventually(() => f.runtime.calls.length === 2)
    expect(f.runtime.calls[1]!.input.prompt).toContain('第二条')
    expect(f.runtime.calls[0]!.input.prompt).not.toContain('第二条')
    f.runtime.calls[1]!.complete({ text: '第二轮完成', stopped: false })
    await eventually(() => f.service.get(chat.conversation.id).runs.every((run) => run.state.kind === 'completed'))
    expect(f.service.get(chat.conversation.id).messages.filter((message) => message.sender.kind === 'user')).toHaveLength(2)
  })

  test('Given 主持人点名专家且专家再次点名，When 有界接力，Then 专家执行一次并由主持人汇总后结束', async () => {
    const f = fixture()
    const lead = f.bot('主持人')
    const expert = f.bot('专家')
    const group = f.group([lead, expert], { kind: 'member', botId: lead.id })
    f.send(group, '调研方案')
    await eventually(() => f.runtime.calls.length === 1)
    f.runtime.calls[0]!.complete({ text: '@专家 请核查源码', stopped: false })
    await eventually(() => f.runtime.calls.length === 2)
    expect(f.runtime.calls[1]!.input.bot.id).toBe(expert.id)
    f.runtime.calls[1]!.complete({ text: '@主持人 核查完成', stopped: false })
    await eventually(() => f.runtime.calls.length === 3)
    expect(f.runtime.calls[2]!.input.bot.id).toBe(lead.id)
    expect(f.runtime.calls[2]!.input.prompt).toContain('核查完成')
    f.runtime.calls[2]!.complete({ text: '@专家 最终汇总', stopped: false })
    await eventually(() => f.service.get(group.conversation.id).runs.every((run) => run.state.kind === 'completed'))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(f.runtime.calls).toHaveLength(3)
  })

  test('Given 用户停止当前成员，When 迟到文本与 completion 返回，Then 取消状态与已展示文字保持不变', async () => {
    const f = fixture()
    const chat = f.direct(f.bot('研究员'))
    f.send(chat, '开始研究')
    await eventually(() => f.runtime.calls.length === 1)
    const turn = f.runtime.calls[0]!
    turn.emit({ kind: 'text', text: '停止前的内容' })
    const runId = f.service.get(chat.conversation.id).runs[0]!.id
    f.service.stop({ conversationId: chat.conversation.id, runId })
    turn.emit({ kind: 'text', text: '不该出现的迟到内容' })
    turn.complete({ text: '迟到完成', stopped: false })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const state = f.service.get(chat.conversation.id)
    expect(state.runs[0]!.state.kind).toBe('cancelled')
    expect(state.messages.at(-1)?.text).toBe('停止前的内容')
    expect(f.runtime.stopped).toEqual([turn.input.sessionId])
  })

  test('Given 执行返回部分文字和错误，When 结束，Then 错误不会被文字或完成状态掩盖', async () => {
    const f = fixture()
    const chat = f.direct(f.bot('研究员'))
    f.send(chat, '检查')
    await eventually(() => f.runtime.calls.length === 1)
    f.runtime.calls[0]!.complete({ text: '部分说明', stopped: false, error: '上游服务失败' })
    await eventually(() => f.service.get(chat.conversation.id).runs[0]?.state.kind === 'failed')
    expect(f.service.get(chat.conversation.id).messages.at(-1)?.text).toBe('部分说明')
    expect(f.service.get(chat.conversation.id).bindings[0]?.consumedThroughSeq).toBe(0)
  })

  test('Given 多成员执行且另有排队消息，When 停止全部工作，Then 所有成员停止且排队消息不会自行启动', async () => {
    const f = fixture()
    const first = f.bot('研究员')
    const second = f.bot('工程师')
    const group = f.group([first, second])
    f.send(group, '@研究员 @工程师 检查', [first.id, second.id])
    await eventually(() => f.runtime.calls.length === 2)
    f.send(group, '@研究员 下一条排队任务', [first.id])
    f.service.stop({ conversationId: group.conversation.id })
    for (const call of f.runtime.calls) call.complete({ text: '迟到的结果', stopped: false })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const state = f.service.get(group.conversation.id)
    expect(state.runs.map((run) => run.state.kind)).toEqual(['cancelled', 'cancelled'])
    expect(state.pending).toHaveLength(0)
    expect(f.runtime.stopped).toHaveLength(2)
    expect(f.runtime.calls).toHaveLength(2)
    expect(state.messages.some((message) => message.text.includes('已取消 1 条排队消息'))).toBe(true)
  })

  test('Given 成员退出后重新加入，When 再次执行，Then 新 Session 只得到重新加入后的公共内容', async () => {
    const f = fixture()
    const lead = f.bot('主持人')
    const expert = f.bot('专家')
    const group = f.group([lead, expert])
    const oldSession = group.bindings.find((binding) => binding.botId === expert.id)!.sessionId
    f.store.transact(group.conversation.id, (draft) => {
      draft.messages.push({ id: randomUUID(), seq: 1, sender: { kind: 'user' }, text: '退出前的私密范围', createdAt: 1, mentionedBotIds: [] })
    })
    f.service.updateConversation({ conversationId: group.conversation.id, memberBotIds: [lead.id] })
    f.service.updateConversation({ conversationId: group.conversation.id, memberBotIds: [lead.id, expert.id] })
    f.send(group, '@专家 加入后的任务', [expert.id])
    await eventually(() => f.runtime.calls.length === 1)
    expect(f.runtime.calls[0]!.input.sessionId).not.toBe(oldSession)
    expect(f.runtime.calls[0]!.input.prompt).toContain('加入后的任务')
    expect(f.runtime.calls[0]!.input.prompt).not.toContain('退出前的私密范围')
    f.runtime.calls[0]!.complete({ text: '已完成', stopped: false })
    await eventually(() => f.service.get(group.conversation.id).runs.at(-1)?.state.kind === 'completed')
  })

  test('Given 磁盘有中断任务与排队输入，When 服务重启，Then 历史仍可读但不会自行重放任务', async () => {
    const f = fixture()
    const researcher = f.bot('研究员')
    const chat = f.direct(researcher)
    f.store.transact(chat.conversation.id, (draft) => {
      draft.pending.push({ requestId: randomUUID(), text: '尚未执行的任务', mentionedBotIds: [], queuedAt: 1 })
      draft.runs.push({ id: randomUUID(), roundId: randomUUID(), botId: researcher.id, sessionId: chat.bindings[0]!.sessionId, inputThroughSeq: 0, outputMessageId: randomUUID(), reason: 'user', state: { kind: 'running', startedAt: 1 } })
    })
    const restored = new BotsService({ store: new BotsStore({ directory: f.directory }), runtime: f.runtime })
    expect(restored.get(chat.conversation.id).runs[0]?.state.kind).toBe('interrupted')
    expect(restored.get(chat.conversation.id).messages.some((message) => message.text.includes('尚未执行的任务'))).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(f.runtime.calls).toHaveLength(0)
    restored.dispose()
  })

  test('Given 仅点名回应的群，When 未点名发送消息，Then 保存记录但不启动任何 Bot', async () => {
    const f = fixture()
    const group = f.group([f.bot('研究员')])
    f.send(group, '先保存想法')
    await eventually(() => f.service.get(group.conversation.id).pending.length === 0)
    expect(f.runtime.calls).toHaveLength(0)
    expect(f.service.get(group.conversation.id).messages[0]?.text).toBe('先保存想法')
  })
})
