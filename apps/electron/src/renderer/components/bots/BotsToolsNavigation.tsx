import type * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Blocks, Brain, CalendarDays, Clock, ListTodo } from 'lucide-react'
import { automationsAtom } from '@/atoms/automation-atoms'
import { botsActiveToolAtom, openBotsToolAtom } from '@/atoms/bots-navigation'
import type { BotsTool } from '@/atoms/bots-navigation'
import { productivityToolsAtom } from '@/atoms/ui-preferences'
import { WorkspaceComponentSidebarEntry } from '@/components/app-shell/WorkspaceComponentSidebarEntry'
import { ObsidianIcon } from '@/components/obsidian/obsidian-brand'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface BotsToolEntry {
  id: BotsTool
  label: string
  icon: React.ReactNode
  visible: boolean
}

export function BotsToolsNavigation({ collapsed = false }: { collapsed?: boolean }): React.ReactElement {
  const openTool = useSetAtom(openBotsToolAtom)
  const activeTool = useAtomValue(botsActiveToolAtom)
  const tools = useAtomValue(productivityToolsAtom)
  const automationCount = useAtomValue(automationsAtom).length
  const entries: BotsToolEntry[] = [
    { id: 'todos', label: 'Todo', icon: <ListTodo size={16} />, visible: tools.todosEnabled },
    { id: 'calendar', label: '日程', icon: <CalendarDays size={16} />, visible: tools.calendarEnabled },
    { id: 'vault', label: 'Obsidian', icon: <ObsidianIcon size={16} />, visible: tools.obsidianEnabled },
    { id: 'memory', label: '项目记忆', icon: <Brain size={16} />, visible: true },
    { id: 'automations', label: '定时任务', icon: <Clock size={16} />, visible: true },
    { id: 'capabilities', label: 'MCP/Skills', icon: <Blocks size={16} />, visible: true },
  ]

  return (
    <nav aria-label="Bots 工具" className={collapsed ? 'flex flex-col items-center gap-1' : 'space-y-0.5 px-3 pb-0.5 pt-2'}>
      {entries.filter((entry) => entry.visible).map((entry) => {
        const active = activeTool === entry.id
        if (collapsed) return (
          <Tooltip key={entry.id}>
            <TooltipTrigger asChild>
              <Button
                variant={active ? 'secondary' : 'ghost'}
                size="icon"
                aria-label={entry.label}
                aria-pressed={active}
                className="titlebar-no-drag shrink-0"
                onClick={() => openTool(entry.id)}
              >{entry.icon}</Button>
            </TooltipTrigger>
            <TooltipContent side="right">{entry.label}</TooltipContent>
          </Tooltip>
        )
        return (
          <WorkspaceComponentSidebarEntry
            key={entry.id}
            label={entry.label}
            icon={entry.icon}
            active={active}
            onClick={() => openTool(entry.id)}
            badge={entry.id === 'automations' && automationCount > 0 ? (
              <span className={cn(
                'flex h-5 min-w-[22px] items-center justify-center rounded-full px-1.5 text-[11px] font-medium tabular-nums',
                active ? 'bg-accent-foreground/[0.26] text-primary-foreground' : 'bg-foreground/[0.045] text-foreground/60 group-hover:text-foreground/75',
              )}>{automationCount > 99 ? '99+' : automationCount}</span>
            ) : undefined}
          />
        )
      })}
    </nav>
  )
}
