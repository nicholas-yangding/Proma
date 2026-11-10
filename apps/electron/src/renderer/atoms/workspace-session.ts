import { atom } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { appModeAtom } from './app-mode'
import {
  agentDiffPanelTabAtom,
  agentSessionComponentOpenMapAtom,
  agentSessionsAtom,
  agentSidePanelLayoutMapAtom,
  agentSidePanelOpenMapAtom,
  agentSidePanelSplitMapAtom,
  agentSidePanelSplitRatioMapAtom,
  agentWorkspacesAtom,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
} from './agent-atoms'
import { botsActiveConversationAtom, botsActiveConversationIdAtom, botsConversationStatesAtom, botsSnapshotAtom, botsWorkspaceSessionIdAtom } from './bot-atoms'

interface SessionWorkspacePanelTarget {
  kind: 'session'
  scopeId: string
  sessionId: string
  workspaceId: string | null
}

interface LocalWorkspacePanelTarget {
  kind: 'workspace'
  scopeId: string
  sessionId: null
  workspaceId: string | null
}

export type WorkspacePanelTarget = SessionWorkspacePanelTarget | LocalWorkspacePanelTarget

/** 文件工作区身份独立于上次查看的 Agent 会话。 */
export const workspaceSessionIdAtom = atom((get) => get(appModeAtom) === 'bots'
  ? get(botsWorkspaceSessionIdAtom)
  : get(currentAgentSessionIdAtom))

export function getBotsConversationScopeId(conversationId: string): string {
  return `bots:conversation:${conversationId}`
}

export const workspacePanelTargetAtom = atom<WorkspacePanelTarget | null>((get) => {
  const selectedId = get(currentAgentWorkspaceIdAtom)
  const workspaces = get(agentWorkspacesAtom)
  const selectedWorkspaceId = workspaces.find((workspace) => workspace.id === selectedId)?.id ?? workspaces[0]?.id ?? null
  if (get(appModeAtom) !== 'bots') {
    const sessionId = get(currentAgentSessionIdAtom)
    if (!sessionId) return null
    const workspaceId = get(agentSessionsAtom).find((session) => session.id === sessionId)?.workspaceId ?? selectedWorkspaceId
    return { kind: 'session', scopeId: sessionId, sessionId, workspaceId }
  }

  const conversationId = get(botsActiveConversationIdAtom)
  const conversation = get(botsActiveConversationAtom)?.conversation
    ?? get(botsSnapshotAtom).conversations.find((item) => item.conversation.id === conversationId)?.conversation
  const workspaceId = conversation?.workspaceId ?? (conversationId ? null : selectedWorkspaceId)
  const sessionId = get(botsWorkspaceSessionIdAtom)
  if (sessionId) return { kind: 'session', scopeId: sessionId, sessionId, workspaceId }
  return {
    kind: 'workspace',
    scopeId: conversationId ? getBotsConversationScopeId(conversationId) : `bots:workspace:${workspaceId ?? 'unselected'}`,
    sessionId: null,
    workspaceId,
  }
})

export const workspacePanelScopeIdAtom = atom((get) => get(workspacePanelTargetAtom)?.scopeId ?? null)

const knownWorkspacePanelScopesAtom = atom((get) => {
  const scopes = new Set(get(agentSessionsAtom).map((session) => session.id))
  for (const state of get(botsConversationStatesAtom).values()) {
    scopes.add(getBotsConversationScopeId(state.conversation.id))
    for (const binding of state.bindings) scopes.add(binding.sessionId)
  }
  for (const item of get(botsSnapshotAtom).conversations) scopes.add(getBotsConversationScopeId(item.conversation.id))
  for (const workspace of get(agentWorkspacesAtom)) scopes.add(`bots:workspace:${workspace.id}`)
  scopes.add('bots:workspace:unselected')
  const currentScope = get(workspacePanelScopeIdAtom)
  if (currentScope) scopes.add(currentScope)
  return scopes
})

export const retainedWorkspacePanelScopesAtom = selectAtom(
  knownWorkspacePanelScopesAtom,
  (scopes) => scopes,
  (previous, next) => previous.size === next.size && [...previous].every((scope) => next.has(scope)),
)

/** 旧聊天首次获得真实绑定时，承接用户已经打开的工作区，不把 UI scope 当 runtime。 */
export const migrateWorkspacePanelScopeAtom = atom(null, (get, set, { fromScopeId, toScopeId }: { fromScopeId: string; toScopeId: string }) => {
  if (fromScopeId === toScopeId) return
  const components = get(agentSessionComponentOpenMapAtom)
  const tabs = get(agentDiffPanelTabAtom)
  const splits = get(agentSidePanelSplitMapAtom)
  if (!(fromScopeId in components) && !tabs.has(fromScopeId) && !splits.has(fromScopeId)) return

  set(agentSessionComponentOpenMapAtom, (previous) => {
    const next = { ...previous, [toScopeId]: [...new Set([...(previous[toScopeId] ?? []), ...(previous[fromScopeId] ?? [])])] }
    delete next[fromScopeId]
    return next
  })
  set(agentDiffPanelTabAtom, (previous) => {
    const next = new Map(previous)
    const tab = next.get(fromScopeId)
    if (tab) next.set(toScopeId, tab)
    next.delete(fromScopeId)
    return next
  })
  set(agentSidePanelSplitMapAtom, (previous) => {
    const next = new Map(previous)
    const split = next.get(fromScopeId)
    if (split) next.set(toScopeId, split)
    next.delete(fromScopeId)
    return next
  })
  set(agentSidePanelOpenMapAtom, (previous) => {
    const next = { ...previous, [toScopeId]: previous[fromScopeId] ?? true }
    delete next[fromScopeId]
    return next
  })
  set(agentSidePanelSplitRatioMapAtom, (previous) => {
    const next = { ...previous }
    const ratio = previous[fromScopeId]
    if (ratio !== undefined) next[toScopeId] = ratio
    delete next[fromScopeId]
    return next
  })
  set(agentSidePanelLayoutMapAtom, (previous) => {
    const next = { ...previous }
    const layout = previous[fromScopeId]
    if (layout) next[toScopeId] = layout
    delete next[fromScopeId]
    return next
  })
})
