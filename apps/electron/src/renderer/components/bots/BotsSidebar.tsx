import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Archive, Bot, Loader2, MessageSquarePlus, PanelLeft, Pencil, Plus, Search, Settings, Users } from 'lucide-react'
import type { BotDefinition } from '@proma/shared'
import {
  botsActiveConversationIdAtom,
  botsApplyConversationAtom,
  botsConversationStatesAtom,
  botsDialogAtom,
  botsLoadingAtom,
  botsSnapshotAtom,
} from '@/atoms/bot-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { openBotsConversationAtom } from '@/atoms/bots-navigation'
import { settingsOpenAtom } from '@/atoms/settings-tab'
import { sidebarCollapsedAtom } from '@/atoms/tab-atoms'
import { ModeSwitcher } from '@/components/app-shell/ModeSwitcher'
import { ShortcutKeycaps } from '@/components/shortcuts/ShortcutKeycaps'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { detectIsMac } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { BotAvatar } from './BotAvatar'
import { BotProfileDialog } from './BotProfileDialog'
import { BotGroupDialog } from './BotGroupDialog'
import { BotTopicDialog } from './BotTopicDialog'
import { BotsToolsNavigation } from './BotsToolsNavigation'
import { getBotsAPI } from './useBotsEvents'
import { getBotError } from './bots-state'

export function BotsSidebar({ width }: { width?: number }): React.ReactElement {
  const isMac = React.useMemo(() => detectIsMac(), [])
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom)
  const snapshot = useAtomValue(botsSnapshotAtom)
  const loading = useAtomValue(botsLoadingAtom)
  const states = useAtomValue(botsConversationStatesAtom)
  const activeId = useAtomValue(botsActiveConversationIdAtom)
  const activeView = useAtomValue(activeViewAtom)
  const openConversation = useSetAtom(openBotsConversationAtom)
  const [dialog, setDialog] = useAtom(botsDialogAtom)
  const apply = useSetAtom(botsApplyConversationAtom)
  const setSnapshot = useSetAtom(botsSnapshotAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const [search, setSearch] = React.useState('')
  const [archived, setArchived] = React.useState(false)
  const [archiveTarget, setArchiveTarget] = React.useState<BotDefinition | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const bots = snapshot.bots.filter((bot) => !bot.archivedAt)
  const shown = snapshot.conversations.filter((item) => Boolean(item.conversation.archivedAt) === archived && `${item.conversation.title} ${item.preview}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const close = (): void => setDialog({ kind: 'none' })
  const openDirect = async (bot: BotDefinition): Promise<void> => {
    const recent = snapshot.conversations.find((item) => item.conversation.kind === 'direct' && item.conversation.botId === bot.id && !item.conversation.archivedAt)
    if (recent) { openConversation(recent.conversation.id); close(); return }
    const state = await getBotsAPI().createBotConversation({ kind: 'direct', botId: bot.id, title: `与${bot.name}聊天`, workspaceId: bot.defaultWorkspaceId })
    apply(state)
    openConversation(state.conversation.id)
    close()
  }
  const editedBot = dialog.kind === 'profile' ? snapshot.bots.find((bot) => bot.id === dialog.botId) : undefined
  const groupState = dialog.kind === 'group' && dialog.conversationId ? states.get(dialog.conversationId) : undefined
  const topicBot = dialog.kind === 'topic' ? bots.find((bot) => bot.id === dialog.botId) : undefined
  if (collapsed) return <aside className={cn('relative flex h-full min-h-0 w-[60px] flex-col items-center gap-3 bg-[hsl(var(--sidebar-surface))]', isMac ? 'pt-[50px]' : 'pt-2')} data-testid="bots-sidebar-collapsed">
    <div aria-hidden="true" className="sidebar-window-drag-strip" style={{ height: isMac ? 50 : 8 }} />
    <Button variant="ghost" size="icon" className="titlebar-no-drag shrink-0" aria-label="展开 Bots 侧边栏" onClick={() => setCollapsed(false)}><PanelLeft /></Button>
    <div className="min-h-0 w-full flex-1 space-y-3 overflow-y-auto pb-1">
      <BotsToolsNavigation collapsed />
      <div className="flex flex-col items-center gap-3" aria-label="最近聊天">
        {shown.slice(0, 6).map((item) => <Button key={item.conversation.id} variant={activeView === 'conversations' && item.conversation.id === activeId ? 'secondary' : 'ghost'} size="icon" className="shrink-0" aria-label={item.conversation.title} onClick={() => openConversation(item.conversation.id)}>{item.conversation.kind === 'group' ? <Users /> : <Bot />}</Button>)}
      </div>
    </div>
    <Button variant="ghost" size="icon" className="mb-3 shrink-0" aria-label="设置" onClick={() => setSettingsOpen(true)}><Settings /></Button>
  </aside>
  return <aside className="relative flex h-full min-h-0 flex-col bg-[hsl(var(--sidebar-surface))] text-sidebar-foreground" style={width ? { width } : undefined} data-testid="bots-sidebar">
    <div aria-hidden="true" className="sidebar-window-drag-strip" style={{ height: isMac ? 30 : 4 }} />
    <div className={cn('w-full flex-shrink-0 titlebar-drag-region', isMac ? 'h-[30px]' : 'h-1')} />
    <div className={cn('titlebar-drag-region flex items-start gap-1.5 px-3', isMac && 'pt-[5px]')}>
      <div className="flex-1 min-w-0"><ModeSwitcher /></div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="收起侧边栏"
            onClick={() => setCollapsed(true)}
            className="sidebar-collapse-button mt-2 size-10 flex-shrink-0 flex items-center justify-center rounded-[10px] text-foreground/40 sidebar-control-surface hover:text-foreground/60 titlebar-no-drag transition-[background-color,color] duration-150"
          >
            <PanelLeft size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <span className="flex items-center gap-2">
            <span>收起侧边栏</span>
            <ShortcutKeycaps shortcutId="toggle-sidebar" keycapClassName="h-5 min-w-5 px-1 text-[11px]" separatorClassName="text-[10px]" />
          </span>
        </TooltipContent>
      </Tooltip>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto pb-2">
      <BotsToolsNavigation />
      <div className="flex items-center justify-between px-4 pb-2 pt-5"><h2 className="text-sm font-medium">{archived ? '已归档聊天' : '最近聊天'}</h2><Button size="icon-sm" variant="ghost" aria-label="管理 Bots" onClick={() => setDialog({ kind: 'manage' })}><Bot /></Button></div>
      <div className="relative mx-3 mb-3"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="h-9 pl-8" aria-label="搜索 Bot 聊天" placeholder="搜索聊天" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <div className="flex gap-2 px-3 pb-3"><Button className="flex-1" variant="outline" size="sm" onClick={() => setDialog({ kind: 'manage' })}><MessageSquarePlus />私聊</Button><Button className="flex-1" variant="outline" size="sm" onClick={() => setDialog({ kind: 'group' })} disabled={bots.length === 0}><Users />建群</Button></div>
      <div className="space-y-1 px-2" aria-label="Bot 聊天列表">
        {loading && <div className="flex items-center justify-center gap-2 p-5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载聊天…</div>}
        {!loading && shown.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">{search ? '没有匹配的聊天' : archived ? '没有归档聊天' : '创建 Bot，开始长期聊天。'}</p>}
        {shown.map((item) => {
          const conversation = item.conversation
          const bot = conversation.kind === 'direct' ? snapshot.bots.find((candidate) => candidate.id === conversation.botId) : undefined
          const selected = activeView === 'conversations' && activeId === conversation.id
          return <button key={conversation.id} type="button" aria-pressed={selected} onClick={() => { openConversation(conversation.id); setError(null) }} className={cn('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-3 text-left transition-colors hover:bg-sidebar-accent', selected && 'bg-sidebar-accent')} data-testid="bot-conversation-item">
            <BotAvatar name={bot?.name ?? conversation.title} avatar={bot?.avatar} group={conversation.kind === 'group'} />
            <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{conversation.title}</span>{item.workingBotIds.length > 0 ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-label="正在工作" /> : item.unreadCount > 0 ? <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground" aria-label={`${item.unreadCount} 条未读`}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</span> : null}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{bot?.name ? `${bot.name} · ` : ''}{item.preview}</span></span>
          </button>
        })}
      </div>
    </div>
    {error && <p role="alert" className="px-4 py-2 text-xs text-destructive">{error}</p>}
    <div className="grid shrink-0 gap-1 border-t border-border/40 p-3"><Button size="sm" variant="ghost" className="justify-start" onClick={() => setDialog({ kind: 'profile' })}><Plus />创建 Bot</Button><div className="flex items-center justify-between"><Button size="sm" variant="ghost" onClick={() => setArchived(!archived)}><Archive />{archived ? '返回最近聊天' : '归档聊天'}</Button><Button size="icon-sm" variant="ghost" aria-label="设置" onClick={() => setSettingsOpen(true)}><Settings /></Button></div></div>
    <BotProfileDialog open={dialog.kind === 'profile'} bot={editedBot} onOpenChange={(open) => { if (!open) close() }} onSaved={editedBot ? undefined : openDirect} />
    <BotGroupDialog open={dialog.kind === 'group'} state={groupState} onOpenChange={(open) => { if (!open) close() }} />
    {topicBot && <BotTopicDialog open={dialog.kind === 'topic'} bot={topicBot} onOpenChange={(open) => { if (!open) close() }} />}
    <Dialog open={dialog.kind === 'manage'} onOpenChange={(open) => { if (!open) close() }}><DialogContent><DialogHeader><DialogTitle>我的 Bots</DialogTitle><DialogDescription>开始私聊，或编辑长期角色。</DialogDescription></DialogHeader><div className="max-h-[50vh] space-y-2 overflow-y-auto">{bots.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">还没有 Bot。</p>}{bots.map((bot) => <div key={bot.id} className="flex items-center gap-2 rounded-lg p-2 hover:bg-accent"><button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => { void openDirect(bot).catch((failure: unknown) => setError(getBotError(failure))) }}><BotAvatar name={bot.name} avatar={bot.avatar} /><span className="truncate text-sm">{bot.name}</span></button><Button variant="ghost" size="icon-sm" aria-label={`编辑${bot.name}`} onClick={() => setDialog({ kind: 'profile', botId: bot.id })}><Pencil /></Button><Button variant="ghost" size="icon-sm" aria-label={`归档${bot.name}`} onClick={() => setArchiveTarget(bot)}><Archive /></Button></div>)}</div><Button onClick={() => setDialog({ kind: 'profile' })}><Plus />创建 Bot</Button></DialogContent></Dialog>
    <AlertDialog open={archiveTarget !== null} onOpenChange={(open) => { if (!open) setArchiveTarget(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>归档 {archiveTarget?.name}？</AlertDialogTitle><AlertDialogDescription>保留已有发言和文件。归档后，这位 Bot 不再接收新任务。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => { const target = archiveTarget; if (!target) return; void getBotsAPI().archiveBot(target.id).then(() => { setSnapshot((current) => ({ ...current, bots: current.bots.map((bot) => bot.id === target.id ? { ...bot, archivedAt: Date.now() } : bot) })); setArchiveTarget(null) }).catch((failure: unknown) => setError(getBotError(failure))) }}>归档</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </aside>
}
