import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import type { BotConversationState } from '@proma/shared'
import { agentDiffPanelTabAtom, agentSessionComponentOpenMapAtom, agentSidePanelOpenMapAtom, agentSidePanelSplitMapAtom, agentSidePanelSplitRatioMapAtom, currentAgentSessionIdAtom } from './agent-atoms'
import { appModeAtom } from './app-mode'
import { botsConversationStatesAtom } from './bot-atoms'
import { migrateWorkspacePanelScopeAtom, retainedWorkspacePanelScopesAtom } from './workspace-session'

describe('Bots 工作区在绑定建立后保留多 Tab', () => {
  test('Given Bot 聊天已有运行绑定，When 切到 Agent 并刷新聊天内容，Then 清理范围仍保留 Bot 工作区且不随消息反复变化', () => {
    const store = createStore()
    const state: BotConversationState = {
      version: 1, revision: 1,
      conversation: { id: 'bot-topic', kind: 'direct', botId: 'research', title: '研究', workspaceId: 'project-b', readThroughSeq: 0, createdAt: 1, updatedAt: 1 },
      bindings: [{ botId: 'research', sessionId: 'bot-runtime', membershipStartedAfterSeq: 0, consumedThroughSeq: 0 }],
      messages: [], runs: [], pending: [], acceptedRequestIds: [],
    }
    store.set(botsConversationStatesAtom, new Map([['bot-topic', state]]))
    store.set(appModeAtom, 'agent')
    store.set(currentAgentSessionIdAtom, 'agent-a')
    const scopes = store.get(retainedWorkspacePanelScopesAtom)
    expect(scopes.has('agent-a')).toBe(true)
    expect(scopes.has('bot-runtime')).toBe(true)
    expect(scopes.has('bots:conversation:bot-topic')).toBe(true)
    store.set(botsConversationStatesAtom, new Map([['bot-topic', { ...state, revision: 2 }]]))
    expect(store.get(retainedWorkspacePanelScopesAtom)).toBe(scopes)
  })

  test('Given 用户已在无运行会话的聊天中打开并排组件，When 真实绑定到达，Then 迁移工作区并保留目标已有 Tab', () => {
    const store = createStore()
    const fromScopeId = 'bots:conversation:topic'
    const toScopeId = 'real-bot-session'
    store.set(agentSessionComponentOpenMapAtom, { [fromScopeId]: ['vault', 'todos'], [toScopeId]: ['memory'] })
    store.set(agentDiffPanelTabAtom, new Map([[fromScopeId, 'vault'], [toScopeId, 'files']]))
    store.set(agentSidePanelOpenMapAtom, { [fromScopeId]: true, 'unrelated-agent': false })
    store.set(agentSidePanelSplitRatioMapAtom, { [fromScopeId]: 0.6 })
    store.set(agentSidePanelSplitMapAtom, new Map([[fromScopeId, { leftTab: 'todos', rightTab: 'vault', focusedPane: 'right', ratio: 0.6 }]]))
    store.set(migrateWorkspacePanelScopeAtom, { fromScopeId, toScopeId })
    expect(store.get(agentSessionComponentOpenMapAtom)[toScopeId]).toEqual(['memory', 'vault', 'todos'])
    expect(store.get(agentSessionComponentOpenMapAtom)[fromScopeId]).toBeUndefined()
    expect(store.get(agentDiffPanelTabAtom).get(toScopeId)).toBe('vault')
    expect(store.get(agentSidePanelSplitMapAtom).get(toScopeId)?.rightTab).toBe('vault')
    expect(store.get(agentSidePanelSplitRatioMapAtom)[toScopeId]).toBe(0.6)
    expect(store.get(agentSidePanelOpenMapAtom)['unrelated-agent']).toBe(false)
    store.set(migrateWorkspacePanelScopeAtom, { fromScopeId, toScopeId })
    expect(store.get(agentSessionComponentOpenMapAtom)[toScopeId]).toEqual(['memory', 'vault', 'todos'])
  })

  test('Given 没有打开过临时工作区，When 初始化绑定，Then 不覆盖已有真实会话的工作区', () => {
    const store = createStore()
    store.set(agentSessionComponentOpenMapAtom, { real: ['skills'] })
    store.set(agentDiffPanelTabAtom, new Map([['real', 'skills']]))
    store.set(migrateWorkspacePanelScopeAtom, { fromScopeId: 'bots:conversation:unused', toScopeId: 'real' })
    expect(store.get(agentDiffPanelTabAtom).get('real')).toBe('skills')
    expect(store.get(agentSessionComponentOpenMapAtom)).toEqual({ real: ['skills'] })
  })
})
