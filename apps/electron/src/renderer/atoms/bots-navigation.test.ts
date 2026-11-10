import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import type { AgentWorkspace, BotConversationState } from '@proma/shared'
import { activeViewAtom } from './active-view'
import { appModeAtom } from './app-mode'
import { automationFormAtom, createEmptyDraft } from './automation-atoms'
import {
  agentDiffPanelTabAtom,
  agentSessionComponentOpenMapAtom,
  agentSessionComponentTabsAtomFamily,
  agentSidePanelOpenAtomFamily,
  agentSidePanelSplitMapAtom,
  agentWorkspacesAtom,
  closeWorkspaceComponentAtom,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
  openWorkspaceComponentAtom,
} from './agent-atoms'
import { botsActiveConversationIdAtom, botsConversationStatesAtom, botsDraftsAtom, botsResourcesAtom } from './bot-atoms'
import { botsActiveToolAtom, openBotsConversationAtom, openBotsToolAtom } from './bots-navigation'
import { productivityToolsAtom } from './ui-preferences'
import { workspacePanelScopeIdAtom, workspacePanelTargetAtom } from './workspace-session'

const workspace: AgentWorkspace = { id: 'bots-project', name: 'Bots 项目', slug: 'bots-project', createdAt: 1, updatedAt: 1 }

function setupStore(bound = true): ReturnType<typeof createStore> {
  const store = createStore()
  store.set(appModeAtom, 'bots')
  store.set(agentSessionComponentOpenMapAtom, {})
  store.set(productivityToolsAtom, { todosEnabled: true, calendarEnabled: true, obsidianEnabled: true })
  store.set(currentAgentWorkspaceIdAtom, workspace.id)
  store.set(agentWorkspacesAtom, [workspace])
  store.set(botsResourcesAtom, { workspaces: [workspace], channels: [] })
  store.set(currentAgentSessionIdAtom, 'previous-agent')
  const state: BotConversationState = {
    version: 1, revision: 1,
    conversation: { id: 'existing-chat', kind: 'direct', botId: 'research', title: '研究', workspaceId: workspace.id, readThroughSeq: 0, createdAt: 1, updatedAt: 1 },
    messages: [],
    bindings: bound ? [{ botId: 'research', sessionId: 'bot-session', membershipStartedAfterSeq: 0, consumedThroughSeq: 0 }] : [],
    runs: [], pending: [], acceptedRequestIds: [],
  }
  store.set(botsConversationStatesAtom, new Map([[state.conversation.id, state]]))
  store.set(botsActiveConversationIdAtom, state.conversation.id)
  store.set(botsDraftsAtom, { 'existing-chat': '尚未发送的草稿' })
  return store
}

function requireScope(store: ReturnType<typeof createStore>): string {
  const scopeId = store.get(workspacePanelScopeIdAtom)
  if (!scopeId) throw new Error('测试需要工作区面板作用域')
  return scopeId
}

describe('Bots 侧栏工作区导航', () => {
  test.each([
    ['todos', ['todos'], 'todos'],
    ['calendar', ['calendar'], 'calendar'],
    ['vault', ['vault'], 'vault'],
    ['memory', ['memory'], 'memory'],
    ['automations', ['automations'], 'automations'],
    ['capabilities', ['mcp', 'skills'], 'skills'],
  ] as const)('Given 真实聊天绑定和未发草稿，When 打开 %s，Then 只打开对应面板 Tab', (tool, expectedTabs, focusedTab) => {
    const store = setupStore()
    const draft = createEmptyDraft()
    draft.name = '正在编辑的定时任务'
    store.set(automationFormAtom, { open: true, draft })
    store.set(openWorkspaceComponentAtom, { scopeId: 'previous-agent', component: 'vault' })
    store.set(openBotsToolAtom, tool)
    expect(store.get(appModeAtom)).toBe('bots')
    expect(store.get(activeViewAtom)).toBe('conversations')
    expect(requireScope(store)).toBe('bot-session')
    expect(store.get(agentSessionComponentTabsAtomFamily('bot-session'))).toEqual([...expectedTabs])
    expect(store.get(agentDiffPanelTabAtom).get('bot-session')).toBe(focusedTab)
    expect(store.get(agentSidePanelOpenAtomFamily('bot-session'))).toBe(true)
    expect(store.get(agentSessionComponentTabsAtomFamily('previous-agent'))).toEqual(['vault'])
    expect(store.get(agentDiffPanelTabAtom).get('previous-agent')).toBe('vault')
    expect(store.get(botsActiveConversationIdAtom)).toBe('existing-chat')
    expect(store.get(botsDraftsAtom)['existing-chat']).toBe('尚未发送的草稿')
    expect(store.get(automationFormAtom)).toEqual({ open: true, draft })
    expect(store.get(botsActiveToolAtom)).toBe(tool)
  })

  test('Given 已有打开的 Tab，When 重复打开能力与记忆，Then 保留原 Tab 并去重', () => {
    const store = setupStore()
    store.set(openBotsToolAtom, 'calendar')
    store.set(openBotsToolAtom, 'capabilities')
    store.set(openBotsToolAtom, 'memory')
    store.set(openBotsToolAtom, 'capabilities')
    expect(store.get(agentSessionComponentTabsAtomFamily(requireScope(store)))).toEqual(['calendar', 'mcp', 'skills', 'memory'])
    expect(store.get(agentDiffPanelTabAtom).get(requireScope(store))).toBe('skills')
  })

  test('Given 零 Bot 零聊天，When 打开六种工具，Then 使用工作区 UI scope 且不创建聊天或借用 Agent', () => {
    const store = setupStore(false)
    store.set(botsActiveConversationIdAtom, null)
    store.set(botsConversationStatesAtom, new Map())
    for (const tool of ['todos', 'calendar', 'vault', 'memory', 'automations', 'capabilities'] as const) store.set(openBotsToolAtom, tool)
    const target = store.get(workspacePanelTargetAtom)
    expect(target?.kind).toBe('workspace')
    expect(target?.sessionId).toBeNull()
    expect(requireScope(store)).not.toBe('previous-agent')
    expect(store.get(agentSessionComponentTabsAtomFamily(requireScope(store)))).toEqual(['todos', 'calendar', 'vault', 'memory', 'automations', 'mcp', 'skills'])
    expect(store.get(agentSessionComponentTabsAtomFamily('previous-agent'))).toEqual([])
    expect(store.get(botsActiveConversationIdAtom)).toBeNull()
    expect(store.get(botsConversationStatesAtom).size).toBe(0)
  })

  test('Given 旧聊天没有运行绑定，When 打开记忆，Then 不依赖发送消息也不改变绑定', () => {
    const store = setupStore(false)
    store.set(openBotsToolAtom, 'memory')
    expect(store.get(workspacePanelTargetAtom)?.kind).toBe('workspace')
    expect(store.get(botsConversationStatesAtom).get('existing-chat')?.bindings).toEqual([])
    expect(store.get(agentSessionComponentTabsAtomFamily(requireScope(store)))).toEqual(['memory'])
  })

  test('Given 可选功能已关闭，When 导航到已关闭功能，Then 不新增 Tab', () => {
    const store = setupStore()
    store.set(productivityToolsAtom, { todosEnabled: false, calendarEnabled: false, obsidianEnabled: false })
    for (const tool of ['todos', 'calendar', 'vault'] as const) store.set(openBotsToolAtom, tool)
    expect(store.get(activeViewAtom)).toBe('conversations')
    expect(store.get(agentSessionComponentTabsAtomFamily(requireScope(store)))).toEqual([])
  })

  test('Given 双 Pane 的实际焦点与旧 active Tab 不同，When 读取高亮或打开组件，Then 跟随实际焦点并正确切换', () => {
    const store = setupStore()
    store.set(openBotsToolAtom, 'capabilities')
    store.set(openBotsToolAtom, 'memory')
    const scopeId = requireScope(store)
    store.set(agentSidePanelSplitMapAtom, new Map([[scopeId, { leftTab: 'memory', rightTab: 'skills', focusedPane: 'right', ratio: 0.5 }]]))
    expect(store.get(botsActiveToolAtom)).toBe('capabilities')
    store.set(openBotsToolAtom, 'memory')
    expect(store.get(agentSidePanelSplitMapAtom).get(scopeId)?.focusedPane).toBe('left')
    expect(store.get(botsActiveToolAtom)).toBe('memory')
    store.set(closeWorkspaceComponentAtom, { scopeId, component: 'memory' })
    expect(store.get(agentSidePanelSplitMapAtom).has(scopeId)).toBe(false)
    expect(store.get(agentDiffPanelTabAtom).get(scopeId)).toBe('skills')
    expect(store.get(agentSessionComponentTabsAtomFamily(scopeId))).toEqual(['mcp', 'skills'])
    store.set(agentSidePanelOpenAtomFamily(scopeId), false)
    expect(store.get(botsActiveToolAtom)).toBeNull()
  })

  test('Given 面板已打开，When 用户关闭再重新打开工具，Then 正确恢复并可关闭对应 Tab', () => {
    const store = setupStore()
    store.set(openBotsToolAtom, 'calendar')
    const scopeId = requireScope(store)
    store.set(agentSidePanelOpenAtomFamily(scopeId), false)
    expect(store.get(botsActiveToolAtom)).toBeNull()
    store.set(openBotsToolAtom, 'calendar')
    expect(store.get(botsActiveToolAtom)).toBe('calendar')
    store.set(closeWorkspaceComponentAtom, { scopeId, component: 'calendar' })
    expect(store.get(agentSessionComponentTabsAtomFamily(scopeId))).toEqual([])
    expect(store.get(botsActiveToolAtom)).toBeNull()
  })

  test('Given 当前工具和聊天草稿，When 用户再次选择该聊天，Then 维持会话页及已有工作区状态', () => {
    const store = setupStore()
    store.set(openBotsToolAtom, 'calendar')
    store.set(openBotsConversationAtom, 'existing-chat')
    expect(store.get(activeViewAtom)).toBe('conversations')
    expect(store.get(botsActiveConversationIdAtom)).toBe('existing-chat')
    expect(store.get(agentSessionComponentTabsAtomFamily(requireScope(store)))).toEqual(['calendar'])
    expect(store.get(botsDraftsAtom)['existing-chat']).toBe('尚未发送的草稿')
  })
})
