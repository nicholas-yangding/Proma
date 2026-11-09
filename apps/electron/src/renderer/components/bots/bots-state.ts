import { getBotConversationMemberIds, getBotMembershipStart } from '@proma/shared'
import type { BotConversationState, BotConversationSummary, BotFileReference, BotsSnapshot } from '@proma/shared'

export function mergeBotFileReferences(previous: BotFileReference[], incoming: BotFileReference[]): BotFileReference[] {
  return [...new Map([...previous, ...incoming].map((file) => [file.path, file])).values()]
}

export function summarizeBotConversation(state: BotConversationState): BotConversationSummary {
  const lastMessage = state.messages.at(-1)
  return {
    conversation: state.conversation,
    preview: lastMessage?.text || (state.pending.length > 0 ? '消息已排队' : '开始新的聊天'),
    unreadCount: state.messages.filter((message) => message.seq > state.conversation.readThroughSeq && message.sender.kind === 'bot' && message.text.trim()).length,
    workingBotIds: [...new Set(state.runs.filter((run) => run.state.kind === 'queued' || run.state.kind === 'running').map((run) => run.botId))],
  }
}

export function applyBotConversation(
  states: ReadonlyMap<string, BotConversationState>,
  incoming: BotConversationState,
): Map<string, BotConversationState> {
  const previous = states.get(incoming.conversation.id)
  if (previous && previous.revision >= incoming.revision) return new Map(states)
  const next = new Map(states)
  next.set(incoming.conversation.id, incoming)
  return next
}

export function mergeBotsSnapshot(
  incoming: BotsSnapshot,
  states: ReadonlyMap<string, BotConversationState>,
): BotsSnapshot {
  const summaries = new Map(incoming.conversations.map((item) => [item.conversation.id, item]))
  for (const state of states.values()) summaries.set(state.conversation.id, summarizeBotConversation(state))
  return {
    bots: incoming.bots,
    conversations: [...summaries.values()].sort((a, b) => b.conversation.updatedAt - a.conversation.updatedAt),
  }
}

export function upsertBotSummary(snapshot: BotsSnapshot, state: BotConversationState): BotsSnapshot {
  const summaries = new Map(snapshot.conversations.map((item) => [item.conversation.id, item]))
  summaries.set(state.conversation.id, summarizeBotConversation(state))
  return { ...snapshot, conversations: [...summaries.values()].sort((a, b) => b.conversation.updatedAt - a.conversation.updatedAt) }
}

export function getBotReadableThroughSeq(state: BotConversationState): number {
  const activeRuns = new Set(state.runs.filter((run) => run.state.kind === 'running' || run.state.kind === 'queued').map((run) => run.id))
  let through = 0
  for (const message of state.messages) {
    if (message.runId && activeRuns.has(message.runId)) break
    through = message.seq
  }
  return through
}

export function getBotError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function getBotsWorkspaceSessionId(state: BotConversationState, selectedBotId?: string, selectedSessionId?: string): string | null {
  if (selectedSessionId && state.bindings.some((binding) => binding.sessionId === selectedSessionId)) return selectedSessionId
  const members = getBotConversationMemberIds(state.conversation)
  const botId = selectedBotId && members.includes(selectedBotId) ? selectedBotId : members[0]
  if (!botId) return null
  const epoch = getBotMembershipStart(state.conversation, botId)
  return state.bindings.findLast((binding) => binding.botId === botId && binding.membershipStartedAfterSeq === epoch)?.sessionId ?? null
}

export interface BotInteractionTarget {
  sessionId: string
  botId: string
  kind: 'permission' | 'question' | 'plan'
}

export function getBotInteractionTargets(
  state: BotConversationState,
  permissions: ReadonlyMap<string, readonly unknown[]>,
  questions: ReadonlyMap<string, readonly unknown[]>,
  plans: ReadonlyMap<string, readonly unknown[]>,
): BotInteractionTarget[] {
  const activeSessions = new Set(state.runs.filter((run) => run.state.kind === 'running' || run.state.kind === 'queued').map((run) => run.sessionId))
  return state.bindings.flatMap((binding): BotInteractionTarget[] => {
    if (!activeSessions.has(binding.sessionId)) return []
    const kind = permissions.get(binding.sessionId)?.length ? 'permission' : questions.get(binding.sessionId)?.length ? 'question' : plans.get(binding.sessionId)?.length ? 'plan' : null
    return kind ? [{ sessionId: binding.sessionId, botId: binding.botId, kind }] : []
  })
}
