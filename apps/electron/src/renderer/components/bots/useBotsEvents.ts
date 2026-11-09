import * as React from 'react'
import { useAtomValue, useStore } from 'jotai'
import type { BotConversationState, BotsAPI } from '@proma/shared'
import {
  botsActiveConversationIdAtom,
  botsApplyConversationAtom,
  botsConversationStatesAtom,
  botsErrorAtom,
  botsLoadingAtom,
  botsResourcesAtom,
  botsSnapshotAtom,
} from '@/atoms/bot-atoms'
import { agentSessionPathMapAtom, agentSessionsAtom, agentWorkspacesAtom } from '@/atoms/agent-atoms'
import { mergeFetchedAgentSessions } from '@/lib/agent-session-list'
import { settingsOpenAtom } from '@/atoms/settings-tab'
import { getBotError, mergeBotsSnapshot } from './bots-state'

export function getBotsAPI(): BotsAPI {
  return window.electronAPI
}

export function useBotsEvents(): void {
  const store = useStore()
  const activeId = useAtomValue(botsActiveConversationIdAtom)
  const settingsOpen = useAtomValue(settingsOpenAtom)

  React.useEffect(() => {
    let disposed = false
    let definitionEvents = 0
    const requestedPaths = new Set<string>()
    let metadataRefresh: Promise<void> | null = null
    let metadataPending = false
    const hydrateMetadata = (): void => {
      metadataPending = true
      if (metadataRefresh) return
      metadataPending = false
      metadataRefresh = Promise.all([window.electronAPI.listAgentSessions(), window.electronAPI.listAgentWorkspaces()])
        .then(([sessions, workspaces]) => {
          if (disposed) return
          store.set(agentSessionsAtom, (previous) => mergeFetchedAgentSessions(previous, sessions))
          store.set(agentWorkspacesAtom, workspaces)
          store.set(botsResourcesAtom, (previous) => ({ ...previous, workspaces }))
        }).catch(() => undefined).finally(() => { metadataRefresh = null; if (metadataPending && !disposed) hydrateMetadata() })
    }
    const hydratePaths = (state: BotConversationState): void => {
      for (const binding of state.bindings) {
        if (requestedPaths.has(binding.sessionId)) continue
        requestedPaths.add(binding.sessionId)
        hydrateMetadata()
        void window.electronAPI.getAgentSessionPath(state.conversation.workspaceId, binding.sessionId)
          .then((path) => {
            if (disposed || !path) return
            store.set(agentSessionPathMapAtom, (previous) => new Map(previous).set(binding.sessionId, path))
          }).catch(() => requestedPaths.delete(binding.sessionId))
      }
    }
    const apply = (state: BotConversationState): void => {
      if (disposed) return
      store.set(botsApplyConversationAtom, state)
      hydratePaths(state)
    }
    const api = getBotsAPI()
    const unsubscribe = api.onBotsEvent((event) => {
      if (disposed) return
      if (event.kind === 'conversation') apply(event.conversation)
      else {
        definitionEvents += 1
        store.set(botsSnapshotAtom, (snapshot) => ({ ...snapshot, bots: event.bots }))
      }
    })
    const refresh = async (): Promise<void> => {
      const definitionsBefore = definitionEvents
      const revisionsBefore = new Map([...store.get(botsConversationStatesAtom)].map(([id, state]) => [id, state.revision]))
      try {
        const snapshot = await api.listBots()
        if (disposed) return
        const bots = definitionsBefore === definitionEvents ? snapshot.bots : store.get(botsSnapshotAtom).bots
        const duringFetch = new Map([...store.get(botsConversationStatesAtom)].filter(([id, state]) => state.revision > (revisionsBefore.get(id) ?? -1)))
        store.set(botsSnapshotAtom, mergeBotsSnapshot({ ...snapshot, bots }, duringFetch))
        const effective = store.get(botsSnapshotAtom)
        const selected = store.get(botsActiveConversationIdAtom)
        if (!selected || !effective.conversations.some((item) => item.conversation.id === selected)) {
          store.set(botsActiveConversationIdAtom, effective.conversations.find((item) => !item.conversation.archivedAt)?.conversation.id ?? null)
        }
        const current = store.get(botsActiveConversationIdAtom)
        if (current) apply(await api.getBotConversation(current))
        store.set(botsErrorAtom, null)
        const [workspaces, channels] = await Promise.all([window.electronAPI.listAgentWorkspaces(), window.electronAPI.listChannels()])
        if (!disposed) {
          store.set(agentWorkspacesAtom, workspaces)
          store.set(botsResourcesAtom, { workspaces, channels })
        }
      } catch (error) {
        if (!disposed) store.set(botsErrorAtom, getBotError(error))
      } finally {
        if (!disposed) store.set(botsLoadingAtom, false)
      }
    }
    void refresh()
    const focus = (): void => { void refresh() }
    window.addEventListener('focus', focus)
    return () => {
      disposed = true
      unsubscribe()
      window.removeEventListener('focus', focus)
    }
  }, [store, settingsOpen])

  React.useEffect(() => {
    if (!activeId) return
    let disposed = false
    void getBotsAPI().getBotConversation(activeId).then((state) => {
      if (disposed) return
      store.set(botsApplyConversationAtom, state)
      for (const binding of state.bindings) {
        void window.electronAPI.getAgentSessionPath(state.conversation.workspaceId, binding.sessionId).then((path) => {
          if (!disposed && path) store.set(agentSessionPathMapAtom, (previous) => new Map(previous).set(binding.sessionId, path))
        }).catch(() => undefined)
      }
    }).catch((error: unknown) => { if (!disposed) store.set(botsErrorAtom, getBotError(error)) })
    return () => { disposed = true }
  }, [activeId, store])
}
