import type * as React from 'react'
import { Users } from 'lucide-react'
import { cn } from '@/lib/utils'

export function BotAvatar({ name, avatar, group, className }: { name: string; avatar?: string; group?: boolean; className?: string }): React.ReactElement {
  return <span aria-hidden="true" className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-secondary text-sm text-secondary-foreground', className)}>
    {group ? <Users className="h-4 w-4" /> : avatar || [...name][0] || 'B'}
  </span>
}
