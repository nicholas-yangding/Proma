/**
 * ModeSwitcher - Chat/Agent 模式切换（带滑动指示器）
 *
 * 切换模式时自动恢复上一次在该模式下查看的对话/会话：
 * 1. 优先恢复上次选中的对话 ID
 * 2. 其次查找已打开的同类型 Tab
 * 3. 兜底打开最近的对话/会话（列表首项）
 * 4. 都没有则仅切换模式
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { appModeAtom, type AppMode } from '@/atoms/app-mode'
import { conversationsAtom, currentConversationIdAtom } from '@/atoms/chat-atoms'
import { agentSessionsAtom, currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { tabsAtom } from '@/atoms/tab-atoms'
import { useOpenSession } from '@/hooks/useOpenSession'
import { Bot, MessageSquare } from 'lucide-react'
import { Users } from 'lucide-react'
import { activeViewAtom } from '@/atoms/active-view'
import { sidebarCollapsedAtom } from '@/atoms/tab-atoms'
import { useSetAtom } from 'jotai'
import { cn } from '@/lib/utils'

const modes: { value: AppMode; label: string; icon: React.ReactNode }[] = [
  { value: 'agent', label: 'Agent', icon: <Bot size={15} /> },
  { value: 'chat', label: 'Chat', icon: <MessageSquare size={15} /> },
  { value: 'bots', label: 'Bots', icon: <Users size={15} /> },
]

export function ModeSwitcher(): React.ReactElement {
  const [mode, setMode] = useAtom(appModeAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setSidebarCollapsed = useSetAtom(sidebarCollapsedAtom)
  const openSession = useOpenSession()
  const conversations = useAtomValue(conversationsAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const currentConversationId = useAtomValue(currentConversationIdAtom)
  const currentAgentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const tabs = useAtomValue(tabsAtom)

  /** 尝试恢复目标模式下的上一个对话/会话，按优先级 fallback */
  const restoreSession = React.useCallback((targetMode: Exclude<AppMode, 'bots'>) => {
    const isChatMode = targetMode === 'chat'
    const sessions = isChatMode ? conversations : agentSessions.filter((session) => !session.botContext)
    const lastId = isChatMode ? currentConversationId : currentAgentSessionId

    // 1. 上次选中的对话仍存在 → 恢复
    if (lastId) {
      const match = sessions.find((s) => s.id === lastId)
      if (match) {
        openSession(targetMode, match.id, match.title)
        return
      }
    }
    // 2. 已打开的同类型 Tab → 聚焦
    const tab = tabs.find((t) => t.type === targetMode)
    if (tab) {
      openSession(targetMode, tab.sessionId, tab.title)
      return
    }
    // 3. 最近的未归档对话/会话 → 打开
    const recent = sessions.find((s) => !s.archived)
    if (recent) {
      openSession(targetMode, recent.id, recent.title)
      return
    }
    // 4. 无任何对话，仅切换模式
    setMode(targetMode)
  }, [openSession, conversations, agentSessions, currentConversationId, currentAgentSessionId, tabs, setMode])

  const handleModeSwitch = React.useCallback((targetMode: AppMode) => {
    if (targetMode === mode) return
    setMode(targetMode)
    setActiveView('conversations')
    if (targetMode === 'bots') {
      setSidebarCollapsed(false)
      return
    }
    restoreSession(targetMode)
  }, [mode, restoreSession, setMode, setActiveView, setSidebarCollapsed])

  return (
    <div className="mode-switcher pt-2 titlebar-drag-region select-none">
      <div
        className="relative flex rounded-xl p-1 titlebar-drag-region mode-switcher-track sidebar-control-surface"
      >
        {/* 滑动背景指示器 */}
        <div
          className={cn(
            'mode-slider pointer-events-none absolute top-1 bottom-1 rounded-lg bg-background shadow-sm transition-transform duration-300 ease-in-out'
          )}
          style={{ width: `calc((100% - 8px) / ${modes.length})`, transform: `translateX(${Math.max(0, modes.findIndex((item) => item.value === mode)) * 100}%)` }}
        />
        {modes.map(({ value, label, icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => handleModeSwitch(value)}
            className={cn(
              'mode-btn titlebar-no-drag relative z-[1] h-8 min-w-0 flex-1 flex items-center justify-center gap-1 rounded-lg px-2 py-0 text-xs font-medium transition-colors duration-200 select-none',
              mode === value
                ? 'mode-btn-selected text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
