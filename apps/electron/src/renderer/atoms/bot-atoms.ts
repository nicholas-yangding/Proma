import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { AgentWorkspace, BotConversationState, BotFileReference, BotsSnapshot, Channel } from '@proma/shared'
import { applyBotConversation, getBotsWorkspaceSessionId, upsertBotSummary } from '@/components/bots/bots-state'

export const botsSnapshotAtom = atom<BotsSnapshot>({ bots: [], conversations: [] })
export const botsConversationStatesAtom = atom<Map<string, BotConversationState>>(new Map())
export const botsActiveConversationIdAtom = atomWithStorage<string | null>('proma-bots-active-conversation', null, undefined, { getOnInit: true })
export const botsDraftsAtom = atomWithStorage<Record<string, string>>('proma-bots-drafts', {}, undefined, { getOnInit: true })
export const botsDraftFilesAtom = atomWithStorage<Record<string, BotFileReference[]>>('proma-bots-draft-files', {}, undefined, { getOnInit: true })
export const botsFileBotIdMapAtom = atomWithStorage<Record<string, string>>('proma-bots-file-members', {}, undefined, { getOnInit: true })
export const botsFileSessionIdMapAtom = atomWithStorage<Record<string, string>>('proma-bots-file-sessions', {}, undefined, { getOnInit: true })
export const botsLoadingAtom = atom(true)
export const botsErrorAtom = atom<string | null>(null)
export const botsResourcesAtom = atom<{ workspaces: AgentWorkspace[]; channels: Channel[] }>({ workspaces: [], channels: [] })
export type BotsDialog = { kind: 'none' } | { kind: 'profile'; botId?: string } | { kind: 'group'; conversationId?: string } | { kind: 'manage' } | { kind: 'topic'; botId: string }
export const botsDialogAtom = atom<BotsDialog>({ kind: 'none' })

export const botsActiveConversationAtom = atom((get) => {
  const id = get(botsActiveConversationIdAtom)
  return id ? get(botsConversationStatesAtom).get(id) ?? null : null
})

export const botsApplyConversationAtom = atom(null, (get, set, incoming: BotConversationState) => {
  const previous = get(botsConversationStatesAtom)
  const known = previous.get(incoming.conversation.id)
  if (known && known.revision >= incoming.revision) return
  const next = applyBotConversation(previous, incoming)
  set(botsConversationStatesAtom, next)
  set(botsSnapshotAtom, upsertBotSummary(get(botsSnapshotAtom), incoming))
})

export const botsWorkspaceSessionIdAtom = atom((get) => {
  const state = get(botsActiveConversationAtom)
  if (!state) return null
  return getBotsWorkspaceSessionId(state, get(botsFileBotIdMapAtom)[state.conversation.id], get(botsFileSessionIdMapAtom)[state.conversation.id])
})
