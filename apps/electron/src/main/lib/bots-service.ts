import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { getBotConversationMemberIds, getBotMembershipStart } from '@proma/shared'
import type {
  BotConversationState, BotDefinition, BotMessage, BotRun, BotSessionBinding,
  BotsEvent, CreateBotConversationInput, SaveBotInput, SendBotMessageInput,
  StopBotRunInput, UpdateBotConversationInput,
} from '@proma/shared'
import type { BotsStore } from './bots-store'
import { getBotResponders, resolveBotMentions } from './bots-routing'
import type { BotRuntime, BotTurnEvent } from './bots-runtime'

interface BotsServiceOptions {
  store: BotsStore
  runtime: BotRuntime
  now?: () => number
}

interface ActiveRound {
  id: string
  cancelled: boolean
  spoken: Set<string>
}

interface TurnOutcome {
  botId: string
  text: string
  completed: boolean
}

interface PendingOutput {
  conversationId: string
  runId: string
  text?: string
  activity?: string
  timer: ReturnType<typeof setTimeout>
}

const MAX_GROUP_HOPS = 1

function nextSeq(state: BotConversationState): number {
  return state.messages.reduce((max, message) => Math.max(max, message.seq), 0) + 1
}

function liveRun(run: BotRun): boolean {
  return run.state.kind === 'queued' || run.state.kind === 'running'
}

export class BotsService {
  private readonly store: BotsStore
  private readonly runtime: BotRuntime
  private readonly now: () => number
  private readonly listeners = new Set<(event: BotsEvent) => void>()
  private readonly draining = new Set<string>()
  private readonly rounds = new Map<string, ActiveRound>()
  private readonly outputs = new Map<string, PendingOutput>()
  private disposed = false

  constructor({ store, runtime, now = Date.now }: BotsServiceOptions) {
    this.store = store
    this.runtime = runtime
    this.now = now
    this.store.recoverInterrupted(this.now())
  }

  list() { return this.store.list() }
  get(conversationId: string) { return this.store.get(conversationId) }

  saveBot(input: SaveBotInput): BotDefinition {
    const bot = this.store.saveBot(input)
    this.publish({ kind: 'definitions', bots: this.store.list().bots })
    return bot
  }

  archiveBot(botId: string): void {
    this.store.archiveBot(botId)
    this.publish({ kind: 'definitions', bots: this.store.list().bots })
  }

  createConversation(input: CreateBotConversationInput): BotConversationState {
    const created = this.store.createConversation(input)
    const prepared = this.ensureBindings(created.conversation.id)
    this.publishConversation(prepared)
    return prepared
  }

  updateConversation(input: UpdateBotConversationInput): BotConversationState {
    const state = this.store.updateConversation(input)
    const prepared = state.conversation.archivedAt ? state : this.ensureBindings(state.conversation.id)
    this.publishConversation(prepared)
    return prepared
  }

  markRead(conversationId: string, throughSeq: number): BotConversationState {
    const state = this.store.markRead(conversationId, throughSeq)
    this.publishConversation(state)
    return state
  }

  subscribe(listener: (event: BotsEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  send(input: SendBotMessageInput): BotConversationState {
    if (this.disposed) throw new Error('Bots 服务已停止。')
    const state = this.store.get(input.conversationId)
    if (state.acceptedRequestIds.includes(input.requestId)) return state
    if (state.conversation.archivedAt) throw new Error('请先恢复已归档的聊天。')
    if (!input.text.trim()) throw new Error('消息不能为空。')
    const members = this.availableMembers(state)
    if (!members.length) throw new Error('聊天中没有可回应的 Bot。')
    if (input.mentionedBotIds.some((id) => !members.some((member) => member.id === id))) throw new Error('提及的 Bot 不是当前可用成员。')
    if (resolveBotMentions(input.text, members, input.mentionedBotIds).ambiguous.length) throw new Error('存在同名 Bot，请从提及列表明确选择。')
    const accepted = this.store.transact(input.conversationId, (draft) => {
      draft.pending.push({ requestId: input.requestId, text: input.text, mentionedBotIds: input.mentionedBotIds, queuedAt: this.now(), files: input.files })
      draft.acceptedRequestIds.push(input.requestId)
    })
    this.publishConversation(accepted)
    this.startDrain(input.conversationId)
    return accepted
  }

  stop(input: StopBotRunInput): void {
    const state = this.store.get(input.conversationId)
    const runs = state.runs.filter((run) => liveRun(run) && (!input.runId || run.id === input.runId))
    if (!runs.length && (input.runId || !state.pending.length)) return
    if (!input.runId) {
      const round = this.rounds.get(input.conversationId)
      if (round) round.cancelled = true
    }
    for (const run of runs) this.flushOutput(run.id)
    const ids = new Set(runs.map((run) => run.id))
    const updated = this.store.transact(input.conversationId, (draft) => {
      for (const run of draft.runs) if (ids.has(run.id)) {
        run.state = { kind: 'cancelled', finishedAt: this.now() }
        delete run.activity
      }
      if (!input.runId && draft.pending.length) {
        draft.messages.push({ id: randomUUID(), seq: nextSeq(draft), sender: { kind: 'system' }, text: `已取消 ${draft.pending.length} 条排队消息。`, createdAt: this.now(), mentionedBotIds: [] })
        draft.pending = []
      }
    })
    this.publishConversation(updated)
    for (const run of runs) {
      this.clearOutput(run.id)
      if (run.state.kind === 'running') this.runtime.stop(run.sessionId)
    }
  }

  dispose(): void {
    if (this.disposed) return
    for (const summary of this.store.list().conversations) this.stop({ conversationId: summary.conversation.id })
    this.disposed = true
    for (const output of this.outputs.values()) clearTimeout(output.timer)
    this.outputs.clear()
    this.listeners.clear()
  }

  private publish(event: BotsEvent): void {
    for (const listener of this.listeners) {
      try { listener(structuredClone(event)) } catch (error) { console.error('[Bots] 事件订阅处理失败:', error) }
    }
  }

  private publishConversation(state: BotConversationState): void {
    this.publish({ kind: 'conversation', conversation: state })
  }

  private availableMembers(state: BotConversationState): BotDefinition[] {
    return getBotConversationMemberIds(state.conversation).map((id) => this.store.getBot(id)).filter((bot) => bot.archivedAt === undefined)
  }

  private ensureBindings(conversationId: string): BotConversationState {
    const state = this.store.get(conversationId)
    const created: BotSessionBinding[] = []
    for (const bot of this.availableMembers(state)) {
      const start = getBotMembershipStart(state.conversation, bot.id)
      if (start === undefined || state.bindings.some((binding) => binding.botId === bot.id && binding.membershipStartedAfterSeq === start)) continue
      created.push({
        botId: bot.id,
        sessionId: this.runtime.ensureSession({ conversationId, botId: bot.id, workspaceId: state.conversation.workspaceId, membershipStartedAfterSeq: start }),
        membershipStartedAfterSeq: start,
        consumedThroughSeq: start,
      })
    }
    return created.length ? this.store.transact(conversationId, (draft) => { draft.bindings.push(...created) }) : state
  }

  private startDrain(conversationId: string): void {
    if (this.draining.has(conversationId)) return
    this.draining.add(conversationId)
    queueMicrotask(() => {
      void this.drain(conversationId).catch((error: unknown) => {
        console.error('[Bots] 聊天任务调度失败:', error)
      }).finally(() => { this.draining.delete(conversationId) })
    })
  }

  private async drain(conversationId: string): Promise<void> {
    while (!this.disposed) {
      const pending = this.store.get(conversationId).pending[0]
      if (!pending) return
      const round: ActiveRound = { id: pending.requestId, cancelled: false, spoken: new Set() }
      this.rounds.set(conversationId, round)
      try {
        const state = this.store.transact(conversationId, (draft) => {
          draft.pending.shift()
          draft.messages.push({ id: pending.requestId, seq: nextSeq(draft), sender: { kind: 'user' }, text: pending.text, createdAt: pending.queuedAt, mentionedBotIds: pending.mentionedBotIds, files: pending.files })
        })
        this.publishConversation(state)
        const members = this.availableMembers(state)
        const initial = state.conversation.kind === 'direct' ? members : getBotResponders(pending.text, members, state.conversation.responder, pending.mentionedBotIds)
        let outcomes = await this.runMembers(conversationId, initial, round, 'user')
        let followed = false
        for (let hop = 0; hop < MAX_GROUP_HOPS && !round.cancelled; hop++) {
          if (state.conversation.kind !== 'group') break
          const next = outcomes.flatMap((outcome) => {
            if (!outcome.completed) return []
            const resolved = resolveBotMentions(outcome.text, members)
            return resolved.bots.filter((bot) => !resolved.ambiguous.some((sharing) => sharing.includes(bot)))
          })
            .filter((bot, index, all) => !round.spoken.has(bot.id) && all.findIndex((item) => item.id === bot.id) === index)
          if (!next.length) break
          followed = true
          outcomes = await this.runMembers(conversationId, next, round, 'mention')
        }
        if (followed && !round.cancelled && state.conversation.kind === 'group' && state.conversation.responder.kind === 'member') {
          const leadId = state.conversation.responder.botId
          const lead = initial.find((bot) => bot.id === leadId)
          if (lead && outcomes.some((outcome) => outcome.completed)) await this.runMembers(conversationId, [lead], round, 'summary')
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.publishConversation(this.store.transact(conversationId, (draft) => {
          draft.messages.push({ id: randomUUID(), seq: nextSeq(draft), sender: { kind: 'system' }, text: `本轮未能执行：${message}`, createdAt: this.now(), mentionedBotIds: [] })
        }))
      } finally {
        this.rounds.delete(conversationId)
      }
    }
  }

  private async runMembers(conversationId: string, bots: BotDefinition[], round: ActiveRound, reason: BotRun['reason']): Promise<TurnOutcome[]> {
    if (round.cancelled || this.disposed) return []
    const state = this.ensureBindings(conversationId)
    const cutoff = nextSeq(state) - 1
    const activeIds = new Set(getBotConversationMemberIds(state.conversation))
    const prepared = bots.map((bot) => this.store.getBot(bot.id)).filter((bot) => activeIds.has(bot.id)
      && bot.archivedAt === undefined && (reason === 'summary' || !round.spoken.has(bot.id)))
    for (const bot of prepared) round.spoken.add(bot.id)
    const outcomes = await Promise.allSettled(prepared.map((bot) => this.runMember(conversationId, bot, cutoff, round, reason)))
    return outcomes.map((outcome, index) => {
      if (outcome.status === 'fulfilled') return outcome.value
      const error: unknown = outcome.reason
      this.publishConversation(this.store.transact(conversationId, (draft) => {
        draft.messages.push({ id: randomUUID(), seq: nextSeq(draft), sender: { kind: 'system' }, text: `成员执行未能启动：${error instanceof Error ? error.message : String(error)}`, createdAt: this.now(), mentionedBotIds: [] })
      }))
      return { botId: prepared[index]!.id, text: '', completed: false }
    })
  }

  private async runMember(conversationId: string, bot: BotDefinition, inputThroughSeq: number, round: ActiveRound, reason: BotRun['reason']): Promise<TurnOutcome> {
    const current = this.store.get(conversationId)
    const start = getBotMembershipStart(current.conversation, bot.id)
    const binding = current.bindings.find((item) => item.botId === bot.id && item.membershipStartedAfterSeq === start)
    if (!binding) throw new Error('找不到 Bot 的执行会话。')
    const run: BotRun = { id: randomUUID(), roundId: round.id, botId: bot.id, sessionId: binding.sessionId, inputThroughSeq, outputMessageId: randomUUID(), reason, state: { kind: 'running', startedAt: this.now() }, activity: '正在处理' }
    const publicInput = current.messages.filter((message) => message.seq > Math.max(binding.consumedThroughSeq, binding.membershipStartedAfterSeq)
      && message.seq <= inputThroughSeq && message.sender.kind !== 'system' && message.text.trim())
    const prompt = publicInput.map((message) => `【公共消息 ${message.seq} · ${message.sender.kind === 'user' ? '用户' : message.sender.kind === 'bot' ? message.sender.name : '系统'}】\n${message.text}${message.files?.length ? '\n\n用户明确引用的文件：\n' + message.files.map((file) => file.path).join('\n') : ''}`).join('\n\n')
      + (reason === 'summary' ? '\n\n请根据成员已经返回的结果汇总当前任务。此轮只做汇总，不再点名派工。' : '\n\n请回应当前任务。仅将可以公开给当前聊天的结果写入最终回复。')
    const memberNames = this.availableMembers(current).map((member) => `@${member.name}`).join('、')
    const additionalDirectories = [...new Set(current.messages.filter((message) => message.seq > binding.membershipStartedAfterSeq && message.seq <= inputThroughSeq)
      .flatMap((message) => message.files ?? []).map((file) => file.isDirectory ? file.path : dirname(file.path)))]
    const systemPromptAppend = `\n\n## Bot 身份\n\n你是长期 Bot「${bot.name}」。\n${bot.instructions}\n\n角色指令不能扩大本次任务的工具权限。当前聊天与其他私聊相互独立，不要读取或披露无关聊天。`
      + (current.conversation.kind === 'group' ? `\n\n## 当前群聊\n\n成员：${memberNames}。\n${current.conversation.instructions}\n如确需其他成员协作，可以在公开回复中明确 @成员。运行时会执行有界交接，不要虚构其他成员已经完成的工作。` : '')
    this.publishConversation(this.store.transact(conversationId, (draft) => {
      draft.runs.push(run)
      draft.messages.push({ id: run.outputMessageId, seq: nextSeq(draft), sender: { kind: 'bot', botId: bot.id, name: bot.name, avatar: bot.avatar }, text: '', createdAt: this.now(), mentionedBotIds: [], runId: run.id, sessionId: binding.sessionId })
    }))
    try {
      const result = await this.runtime.run({ bot, conversation: current.conversation, sessionId: binding.sessionId, prompt, systemPromptAppend, inputThroughSeq, additionalDirectories }, (event) => this.queueOutput(conversationId, run.id, event))
      if (!this.store.get(conversationId).runs.some((item) => item.id === run.id && liveRun(item))) return { botId: bot.id, text: '', completed: false }
      this.flushOutput(run.id)
      let completed = false
      this.publishConversation(this.store.transact(conversationId, (draft) => {
        const savedRun = draft.runs.find((item) => item.id === run.id)
        if (!savedRun || !liveRun(savedRun)) return
        const message = draft.messages.find((item) => item.id === run.outputMessageId)
        if (message && result.text) message.text = result.text
        savedRun.state = result.stopped ? { kind: 'cancelled', finishedAt: this.now() }
          : result.error ? { kind: 'failed', finishedAt: this.now(), error: result.error }
            : !result.text.trim() ? { kind: 'failed', finishedAt: this.now(), error: 'Bot 没有返回可公开的回复。' }
              : { kind: 'completed', finishedAt: this.now() }
        delete savedRun.activity
        completed = savedRun.state.kind === 'completed'
        if (completed) {
          const savedBinding = draft.bindings.find((item) => item.sessionId === binding.sessionId)
          if (savedBinding) savedBinding.consumedThroughSeq = Math.max(savedBinding.consumedThroughSeq, inputThroughSeq)
        }
      }))
      return { botId: bot.id, text: result.text, completed }
    } catch (error) {
      if (!this.store.get(conversationId).runs.some((item) => item.id === run.id && liveRun(item))) return { botId: bot.id, text: '', completed: false }
      this.flushOutput(run.id)
      this.publishConversation(this.store.transact(conversationId, (draft) => {
        const saved = draft.runs.find((item) => item.id === run.id)
        if (saved && liveRun(saved)) {
          saved.state = { kind: 'failed', finishedAt: this.now(), error: error instanceof Error ? error.message : String(error) }
          delete saved.activity
        }
      }))
      return { botId: bot.id, text: '', completed: false }
    } finally {
      this.clearOutput(run.id)
    }
  }

  private queueOutput(conversationId: string, runId: string, event: BotTurnEvent): void {
    if (this.disposed || !this.store.get(conversationId).runs.some((run) => run.id === runId && run.state.kind === 'running')) return
    let output = this.outputs.get(runId)
    if (!output) {
      output = { conversationId, runId, timer: setTimeout(() => this.flushOutput(runId), 150) }
      this.outputs.set(runId, output)
    }
    if (event.kind === 'text') output.text = event.text
    else output.activity = event.text
  }

  private flushOutput(runId: string): void {
    const output = this.outputs.get(runId)
    if (!output) return
    this.clearOutput(runId)
    this.publishConversation(this.store.transact(output.conversationId, (draft) => {
      const run = draft.runs.find((item) => item.id === runId)
      if (run?.state.kind !== 'running') return
      const message = draft.messages.find((item) => item.id === run.outputMessageId)
      if (message && output.text !== undefined) message.text = output.text
      if (output.activity !== undefined) run.activity = output.activity
    }))
  }

  private clearOutput(runId: string): void {
    const output = this.outputs.get(runId)
    if (output) clearTimeout(output.timer)
    this.outputs.delete(runId)
  }
}
