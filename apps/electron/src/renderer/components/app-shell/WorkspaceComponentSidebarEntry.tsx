import type * as React from 'react'
import { cn } from '@/lib/utils'

interface WorkspaceComponentSidebarEntryProps {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
  badge?: React.ReactNode
}

export function WorkspaceComponentSidebarEntry({ label, icon, active, onClick, badge }: WorkspaceComponentSidebarEntryProps): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'group flex w-full items-center justify-between rounded-md px-3 py-2 text-[13px] transition-colors duration-100 titlebar-no-drag',
        active
          ? 'bg-accent-foreground/[0.10] text-[hsl(var(--sidebar-primary-foreground))] shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
          : 'text-[hsl(var(--sidebar-primary-foreground))] hover:bg-accent-foreground/[0.08] hover:text-[hsl(var(--sidebar-primary-foreground))]',
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className={cn('flex size-[18px] shrink-0 items-center justify-center', active ? 'text-accent-foreground' : 'text-[hsl(var(--sidebar-primary-foreground))]')}>
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </span>
      {badge && <span className="ml-2 flex shrink-0 items-center">{badge}</span>}
    </button>
  )
}
