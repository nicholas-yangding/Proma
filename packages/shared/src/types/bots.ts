import type { PromaPermissionMode } from './agent'

export type BotModelSelection =
  | { kind: 'default' }
  | { kind: 'fixed'; channelId: string; modelId: string }

export interface BotDefinition {
  id: string
  name: string
  avatar: string
  instructions: string
  model: BotModelSelection
  defaultWorkspaceId: string
  permissionMode: PromaPermissionMode
  createdAt: number
  updatedAt: number
  archivedAt?: number
}

export interface SaveBotInput {
  id?: string
  name: string
  avatar: string
  instructions: string
  model: BotModelSelection
  defaultWorkspaceId: string
  permissionMode: PromaPermissionMode
}

export type BotResponder =
  | { kind: 'member'; botId: string }
  | { kind: 'mentions' }
  | { kind: 'everyone' }

export interface BotMembership {
  botId: string
  joinedAfterSeq: number
  leftAfterSeq?: number
}

interface BotConversationBase {
  id: string
  title: string
  workspaceId: string
  createdAt: number
  updatedAt: number
  readThroughSeq: number
  archivedAt?: number
}

export type BotConversation = BotConversationBase & (
  | { kind: 'direct'; botId: string }
  | { kind: 'group'; members: BotMembership[]; responder: BotResponder; instructions: string }
)

export type CreateBotConversationInput =
  | { kind: 'direct'; botId: string; title: string; workspaceId: string }
  | { kind: 'group'; memberBotIds: string[]; title: string; workspaceId: string; responder: BotResponder; instructions: string }

export interface UpdateBotConversationInput {
  conversationId: string
  title?: string
  archived?: boolean
  memberBotIds?: string[]
  responder?: BotResponder
  instructions?: string
}

export type BotSender =
  | { kind: 'user' }
  | { kind: 'bot'; botId: string; name: string; avatar: string }
  | { kind: 'system' }

export interface BotFileReference {
  path: string
  name: string
  isDirectory: boolean
  sourceSessionId?: string
}

export interface BotMessage {
  id: string
  seq: number
  sender: BotSender
  text: string
  createdAt: number
  mentionedBotIds: string[]
  runId?: string
  sessionId?: string
  files?: BotFileReference[]
}

export interface BotSessionBinding {
  botId: string
  sessionId: string
  membershipStartedAfterSeq: number
  consumedThroughSeq: number
}

export type BotRunState =
  | { kind: 'queued' }
  | { kind: 'running'; startedAt: number }
  | { kind: 'completed'; finishedAt: number }
  | { kind: 'failed'; finishedAt: number; error: string }
  | { kind: 'cancelled'; finishedAt: number }
  | { kind: 'interrupted'; finishedAt: number }

export interface BotRun {
  id: string
  roundId: string
  botId: string
  sessionId: string
  inputThroughSeq: number
  outputMessageId: string
  reason: 'user' | 'mention' | 'summary'
  state: BotRunState
  activity?: string
}

export interface BotPendingSend {
  requestId: string
  text: string
  mentionedBotIds: string[]
  queuedAt: number
  files?: BotFileReference[]
}

export interface BotConversationState {
  version: 1
  revision: number
  conversation: BotConversation
  messages: BotMessage[]
  bindings: BotSessionBinding[]
  runs: BotRun[]
  pending: BotPendingSend[]
  acceptedRequestIds: string[]
}

export interface BotConversationSummary {
  conversation: BotConversation
  preview: string
  unreadCount: number
  workingBotIds: string[]
}

export interface BotsSnapshot {
  bots: BotDefinition[]
  conversations: BotConversationSummary[]
}

export interface SendBotMessageInput {
  conversationId: string
  requestId: string
  text: string
  mentionedBotIds: string[]
  files?: BotFileReference[]
}

export interface StopBotRunInput {
  conversationId: string
  runId?: string
}

export type BotsEvent =
  | { kind: 'conversation'; conversation: BotConversationState }
  | { kind: 'definitions'; bots: BotDefinition[] }

export interface BotsAPI {
  listBots: () => Promise<BotsSnapshot>
  saveBot: (input: SaveBotInput) => Promise<BotDefinition>
  archiveBot: (botId: string) => Promise<void>
  createBotConversation: (input: CreateBotConversationInput) => Promise<BotConversationState>
  updateBotConversation: (input: UpdateBotConversationInput) => Promise<BotConversationState>
  getBotConversation: (conversationId: string) => Promise<BotConversationState>
  sendBotMessage: (input: SendBotMessageInput) => Promise<BotConversationState>
  stopBotRun: (input: StopBotRunInput) => Promise<void>
  markBotConversationRead: (conversationId: string, throughSeq: number) => Promise<BotConversationState>
  onBotsEvent: (listener: (event: BotsEvent) => void) => () => void
}

export const BOTS_IPC_CHANNELS = {
  LIST: 'bots:list',
  SAVE: 'bots:save',
  ARCHIVE: 'bots:archive',
  CREATE_CONVERSATION: 'bots:create-conversation',
  UPDATE_CONVERSATION: 'bots:update-conversation',
  GET_CONVERSATION: 'bots:get-conversation',
  SEND: 'bots:send',
  STOP: 'bots:stop',
  MARK_READ: 'bots:mark-read',
  EVENT: 'bots:event',
} as const

export function getBotConversationMemberIds(conversation: BotConversation): string[] {
  return conversation.kind === 'direct'
    ? [conversation.botId]
    : conversation.members.filter((member) => member.leftAfterSeq === undefined).map((member) => member.botId)
}

export function getBotMembershipStart(conversation: BotConversation, botId: string): number | undefined {
  if (conversation.kind === 'direct') return conversation.botId === botId ? 0 : undefined
  for (let index = conversation.members.length - 1; index >= 0; index--) {
    const member = conversation.members[index]
    if (member?.botId === botId && member.leftAfterSeq === undefined) return member.joinedAfterSeq
  }
  return undefined
}
