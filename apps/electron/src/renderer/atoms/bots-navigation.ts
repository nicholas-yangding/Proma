import { atom } from 'jotai'
import { activeViewAtom } from './active-view'
import { appModeAtom } from './app-mode'
import { agentDiffPanelTabAtom, agentSidePanelOpenAtomFamily, agentSidePanelSplitMapAtom, openWorkspaceComponentAtom } from './agent-atoms'
import { botsActiveConversationIdAtom } from './bot-atoms'
import { productivityToolsAtom } from './ui-preferences'
import { workspacePanelScopeIdAtom } from './workspace-session'
import { getFocusedRightWorkspaceTab } from '@/lib/right-workspace-split'

export type BotsTool = 'todos' | 'calendar' | 'vault' | 'memory' | 'automations' | 'capabilities'

/** 高亮跟随当前工作区实际聚焦的 Tab，包括双 Pane 的焦点。 */
export const botsActiveToolAtom = atom((get): BotsTool | null => {
  const scopeId = get(workspacePanelScopeIdAtom)
  if (!scopeId || !get(agentSidePanelOpenAtomFamily(scopeId))) return null
  const split = get(agentSidePanelSplitMapAtom).get(scopeId)
  const tab = split ? getFocusedRightWorkspaceTab(split) : get(agentDiffPanelTabAtom).get(scopeId)
  switch (tab) {
    case 'todos':
    case 'calendar':
    case 'vault':
    case 'memory':
    case 'automations':
      return tab
    case 'mcp':
    case 'skills':
      return 'capabilities'
    default:
      return null
  }
})

/** Bots 工具复用工作区面板，聊天与已有 Tab 保持原位。 */
export const openBotsToolAtom = atom(null, (get, set, tool: BotsTool) => {
  const tools = get(productivityToolsAtom)
  if ((tool === 'todos' && !tools.todosEnabled)
    || (tool === 'calendar' && !tools.calendarEnabled)
    || (tool === 'vault' && !tools.obsidianEnabled)) return

  set(appModeAtom, 'bots')
  set(activeViewAtom, 'conversations')
  const scopeId = get(workspacePanelScopeIdAtom)
  if (!scopeId) return
  switch (tool) {
    case 'todos':
    case 'calendar':
    case 'automations':
    case 'vault':
    case 'memory':
      set(openWorkspaceComponentAtom, { scopeId, component: tool })
      return
    case 'capabilities':
      set(openWorkspaceComponentAtom, { scopeId, component: 'mcp' })
      set(openWorkspaceComponentAtom, { scopeId, component: 'skills' })
      return
    default: {
      const exhaustive: never = tool
      return exhaustive
    }
  }
})

/** 仅由用户选择聊天时调用；后台 activeId 同步不改变正在查看的工具页。 */
export const openBotsConversationAtom = atom(null, (_get, set, conversationId: string) => {
  set(appModeAtom, 'bots')
  set(botsActiveConversationIdAtom, conversationId)
  set(activeViewAtom, 'conversations')
})
