import * as React from 'react'
import { useAtomValue } from 'jotai'
import type { BotConversationState } from '@proma/shared'
import { allPendingAskUserRequestsAtom, allPendingExitPlanRequestsAtom, allPendingPermissionRequestsAtom } from '@/atoms/agent-atoms'
import { AskUserBanner } from '@/components/agent/AskUserBanner'
import { ExitPlanModeBanner } from '@/components/agent/ExitPlanModeBanner'
import { PermissionBanner } from '@/components/agent/PermissionBanner'
import { Button } from '@/components/ui/button'
import { getBotInteractionTargets } from './bots-state'

export function BotInteractionBanner({ state, children, onSelectFileBot }: {
  state: BotConversationState
  children: React.ReactNode
  onSelectFileBot: (botId: string, sessionId?: string) => void
}): React.ReactElement {
  const permissions = useAtomValue(allPendingPermissionRequestsAtom)
  const questions = useAtomValue(allPendingAskUserRequestsAtom)
  const plans = useAtomValue(allPendingExitPlanRequestsAtom)
  const [selectedSessionId, setSelectedSessionId] = React.useState<string | null>(null)
  const targets = getBotInteractionTargets(state, permissions, questions, plans)
  const target = targets.find((item) => item.sessionId === selectedSessionId) ?? targets[0]
  if (!target) return <>{children}</>
  const names = new Map(state.messages.flatMap((message) => message.sender.kind === 'bot' ? [[message.sender.botId, message.sender.name] as const] : []))
  return <div className="border-t border-border/50" data-testid="bot-interaction-banner" onClickCapture={(event) => { if (event.target instanceof Element && event.target.closest('button,a')) onSelectFileBot(target.botId, target.sessionId) }}>
    <div className="flex flex-wrap items-center gap-2 px-5 py-2.5"><span className="text-xs text-muted-foreground">等待你处理</span>{targets.map((item) => <Button key={item.sessionId} type="button" size="sm" variant={item.sessionId === target.sessionId ? 'secondary' : 'ghost'} onClick={() => { setSelectedSessionId(item.sessionId); onSelectFileBot(item.botId, item.sessionId) }}>{names.get(item.botId) ?? 'Bot'} · {item.kind === 'permission' ? '工具授权' : item.kind === 'question' ? '问题' : '计划审批'}</Button>)}</div>
    {target.kind === 'permission' ? <PermissionBanner key={target.sessionId} sessionId={target.sessionId} /> : target.kind === 'question' ? <AskUserBanner key={target.sessionId} sessionId={target.sessionId} /> : <ExitPlanModeBanner key={target.sessionId} sessionId={target.sessionId} />}
  </div>
}
