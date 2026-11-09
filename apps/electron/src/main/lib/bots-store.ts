import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getBotConversationMemberIds } from '@proma/shared'
import type {
  BotConversation, BotConversationState, BotDefinition, BotMessage, BotResponder, BotsSnapshot,
  CreateBotConversationInput, SaveBotInput, UpdateBotConversationInput,
} from '@proma/shared'
import { readJsonFileSafe, writeJsonFileAtomic } from './safe-file'
import {
  botConversationStateSchema, botDefinitionSchema, botDefinitionsFileSchema,
  botIdSchema, createBotConversationInputSchema, saveBotInputSchema, updateBotConversationInputSchema,
} from './bots-validation'

interface BotsStoreOptions {
  directory: string
  now?: () => number
  id?: () => string
}

function maxSequence(state: BotConversationState): number {
  return state.messages.at(-1)?.seq ?? 0
}

function isBusy(state: BotConversationState): boolean {
  return state.pending.length > 0 || state.runs.some((run) => run.state.kind === 'queued' || run.state.kind === 'running')
}

export class BotsStore {
  private readonly directory: string
  private readonly conversationsDirectory: string
  private readonly definitionsPath: string
  private readonly now: () => number
  private readonly id: () => string
  private definitions: BotDefinition[]
  private readonly conversations = new Map<string, BotConversationState>()

  constructor(options: BotsStoreOptions) {
    this.directory = options.directory
    this.conversationsDirectory = join(this.directory, 'conversations')
    this.definitionsPath = join(this.directory, 'definitions.json')
    this.now = options.now ?? Date.now
    this.id = options.id ?? randomUUID
    mkdirSync(this.conversationsDirectory, { recursive: true, mode: 0o700 })
    const rawDefinitions = this.readExisting(this.definitionsPath)
    this.definitions = rawDefinitions === undefined ? [] : botDefinitionsFileSchema.parse(rawDefinitions).bots
    const ids = new Set<string>()
    for (const entry of readdirSync(this.conversationsDirectory)) {
      const match = /^([\w-]{1,128})\.json(?:\.tmp|\.bak)?$/.exec(entry)
      if (match?.[1]) ids.add(match[1])
    }
    for (const id of ids) {
      const raw = this.readExisting(this.conversationPath(id))
      if (raw === undefined) continue
      const parsed = botConversationStateSchema.safeParse(raw)
      if (!parsed.success || parsed.data.conversation.id !== id) throw new Error(`Bots 聊天记录损坏，未覆盖原文件: ${id}`)
      this.conversations.set(id, parsed.data)
    }
  }

  private readExisting(path: string): unknown {
    const exists = [path, `${path}.tmp`, `${path}.bak`].some((candidate) => existsSync(candidate))
    if (!exists) return undefined
    const value = readJsonFileSafe<unknown>(path)
    if (value === null) throw new Error(`Bots 数据无法恢复，未覆盖原文件: ${path}`)
    return value
  }

  private conversationPath(id: string): string {
    return join(this.conversationsDirectory, `${botIdSchema.parse(id)}.json`)
  }

  private saveDefinitions(next: BotDefinition[]): void {
    const file = botDefinitionsFileSchema.parse({ version: 1, bots: next })
    writeJsonFileAtomic(this.definitionsPath, file)
    this.definitions = file.bots
  }

  private commit(state: BotConversationState): BotConversationState {
    const next = botConversationStateSchema.parse(state)
    writeJsonFileAtomic(this.conversationPath(next.conversation.id), next)
    this.conversations.set(next.conversation.id, next)
    return structuredClone(next)
  }

  private activeBot(id: string): BotDefinition {
    const bot = this.getBot(id)
    if (bot.archivedAt !== undefined) throw new Error('Bot 已归档，无法开始新的工作')
    return bot
  }

  private assertResponder(responder: BotResponder, ids: readonly string[]): void {
    if (responder.kind === 'member' && !ids.includes(responder.botId)) throw new Error('负责人必须是当前群成员')
  }

  private systemMessage(state: BotConversationState, text: string, now: number): BotMessage {
    return {
      id: this.id(), seq: maxSequence(state) + 1, sender: { kind: 'system' },
      text, createdAt: now, mentionedBotIds: [],
    }
  }

  list(): BotsSnapshot {
    const conversations = [...this.conversations.values()].map((state) => ({
      conversation: structuredClone(state.conversation),
      preview: [...state.messages].reverse().find((message) => message.text.trim())?.text.slice(0, 160) ?? '',
      unreadCount: state.messages.filter((message) => message.seq > state.conversation.readThroughSeq && message.sender.kind === 'bot' && message.text.trim()).length,
      workingBotIds: [...new Set(state.runs.filter((run) => run.state.kind === 'queued' || run.state.kind === 'running').map((run) => run.botId))],
    })).sort((a, b) => b.conversation.updatedAt - a.conversation.updatedAt || a.conversation.id.localeCompare(b.conversation.id))
    return { bots: structuredClone(this.definitions), conversations }
  }

  get(id: string): BotConversationState {
    const state = this.conversations.get(botIdSchema.parse(id))
    if (!state) throw new Error('聊天不存在')
    return structuredClone(state)
  }

  getBot(id: string): BotDefinition {
    const validId = botIdSchema.parse(id)
    const bot = this.definitions.find((candidate) => candidate.id === validId)
    if (!bot) throw new Error('Bot 不存在')
    return structuredClone(bot)
  }

  saveBot(input: SaveBotInput): BotDefinition {
    const parsed = saveBotInputSchema.parse(input)
    const previous = parsed.id ? this.getBot(parsed.id) : undefined
    if (previous?.archivedAt !== undefined) throw new Error('Bot 已归档，无法修改')
    const now = this.now()
    const id = previous?.id ?? botIdSchema.parse(this.id())
    if (!previous && this.definitions.some((bot) => bot.id === id)) throw new Error('Bot 标识已存在')
    const { id: _id, ...fields } = parsed
    const bot = botDefinitionSchema.parse({ ...fields, id, createdAt: previous?.createdAt ?? now, updatedAt: now })
    const next = previous ? this.definitions.map((candidate) => candidate.id === id ? bot : candidate) : [...this.definitions, bot]
    this.saveDefinitions(next)
    return structuredClone(bot)
  }

  archiveBot(id: string): void {
    const bot = this.getBot(id)
    if (bot.archivedAt !== undefined) return
    const busy = [...this.conversations.values()].some((state) => getBotConversationMemberIds(state.conversation).includes(id) && isBusy(state))
    if (busy) throw new Error('Bot 正在工作，请先停止相关聊天')
    const now = this.now()
    this.saveDefinitions(this.definitions.map((candidate) => candidate.id === id ? { ...candidate, archivedAt: now, updatedAt: now } : candidate))
  }

  createConversation(input: CreateBotConversationInput): BotConversationState {
    const parsed = createBotConversationInputSchema.parse(input)
    const ids = parsed.kind === 'direct' ? [parsed.botId] : parsed.memberBotIds
    for (const id of ids) this.activeBot(id)
    if (parsed.kind === 'group') this.assertResponder(parsed.responder, ids)
    const id = botIdSchema.parse(this.id())
    if (this.conversations.has(id)) throw new Error('聊天标识已存在')
    const now = this.now()
    const base = { id, title: parsed.title, workspaceId: parsed.workspaceId, createdAt: now, updatedAt: now, readThroughSeq: 0 }
    const conversation: BotConversation = parsed.kind === 'direct'
      ? { ...base, kind: 'direct', botId: parsed.botId }
      : { ...base, kind: 'group', members: ids.map((botId) => ({ botId, joinedAfterSeq: 0 })), responder: parsed.responder, instructions: parsed.instructions }
    const state = botConversationStateSchema.parse({
      version: 1, revision: 0, conversation, messages: [], bindings: [], runs: [], pending: [], acceptedRequestIds: [],
    })
    return this.commit(state)
  }

  updateConversation(input: UpdateBotConversationInput): BotConversationState {
    const parsed = updateBotConversationInputSchema.parse(input)
    const previous = this.get(parsed.conversationId)
    const changesScope = parsed.memberBotIds !== undefined || parsed.responder !== undefined || parsed.instructions !== undefined || parsed.archived === true
    if (changesScope && isBusy(previous)) throw new Error('聊天正在工作，请先停止后修改成员或设置')
    if (previous.conversation.kind === 'direct' && (parsed.memberBotIds !== undefined || parsed.responder !== undefined || parsed.instructions !== undefined)) throw new Error('私聊不能修改群设置')
    if (parsed.memberBotIds) for (const id of parsed.memberBotIds) this.activeBot(id)
    return this.transact(parsed.conversationId, (state) => {
      if (parsed.title !== undefined) state.conversation.title = parsed.title
      if (parsed.archived === true) state.conversation.archivedAt = this.now()
      if (parsed.archived === false) delete state.conversation.archivedAt
      if (state.conversation.kind !== 'group') return
      const group = state.conversation
      if (parsed.memberBotIds) {
        const nextIds = parsed.memberBotIds
        const current = getBotConversationMemberIds(group)
        const changed = current.some((id) => !nextIds.includes(id)) || nextIds.some((id) => !current.includes(id))
        if (changed) {
          const notice = this.systemMessage(state, '群成员已更新。新加入的成员从此处开始接收消息。', this.now())
          state.messages.push(notice)
          for (const member of group.members) {
            if (member.leftAfterSeq === undefined && !nextIds.includes(member.botId)) member.leftAfterSeq = notice.seq
          }
          for (const botId of nextIds) {
            if (!current.includes(botId)) group.members.push({ botId, joinedAfterSeq: notice.seq })
          }
          if (!parsed.responder && group.responder.kind === 'member' && !nextIds.includes(group.responder.botId)) group.responder = { kind: 'mentions' }
        }
      }
      if (parsed.responder !== undefined) group.responder = parsed.responder
      this.assertResponder(group.responder, getBotConversationMemberIds(group))
      if (parsed.instructions !== undefined) group.instructions = parsed.instructions
    })
  }

  transact(id: string, change: (draft: BotConversationState) => void): BotConversationState {
    const draft = this.get(id)
    change(draft)
    if (draft.conversation.id !== id) throw new Error('不能修改聊天标识')
    draft.revision += 1
    draft.conversation.updatedAt = this.now()
    return this.commit(draft)
  }

  recoverInterrupted(now = this.now()): BotConversationState[] {
    const recovered: BotConversationState[] = []
    for (const state of this.conversations.values()) {
      if (!isBusy(state)) continue
      recovered.push(this.transact(state.conversation.id, (draft) => {
        for (const run of draft.runs) {
          if (run.state.kind === 'queued' || run.state.kind === 'running') {
            run.state = { kind: 'interrupted', finishedAt: now }
            delete run.activity
          }
        }
        for (const pending of draft.pending) {
          draft.messages.push({
            id: pending.requestId, seq: maxSequence(draft) + 1, sender: { kind: 'user' },
            text: pending.text, createdAt: pending.queuedAt, mentionedBotIds: pending.mentionedBotIds,
          })
        }
        draft.pending = []
        draft.messages.push(this.systemMessage(draft, '上次工作已中断，已有内容已保留。请重新发送消息以继续。', now))
      }))
    }
    return recovered
  }

  markRead(id: string, throughSeq: number): BotConversationState {
    if (!Number.isSafeInteger(throughSeq) || throughSeq < 0) throw new Error('已读位置无效')
    const state = this.get(id)
    const next = Math.min(maxSequence(state), Math.max(state.conversation.readThroughSeq, throughSeq))
    if (next === state.conversation.readThroughSeq) return state
    state.conversation.readThroughSeq = next
    state.revision += 1
    return this.commit(state)
  }
}
