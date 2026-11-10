import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { Archive, Bot, Columns2, FolderOpen, Loader2, MoreHorizontal, Pencil, Plus, RotateCcw, Settings2, Users } from 'lucide-react'
import { getBotConversationMemberIds, getBotMembershipStart } from '@proma/shared'
import type { BotFileReference } from '@proma/shared'
import {
  botsActiveConversationAtom,
  botsActiveConversationIdAtom,
  botsApplyConversationAtom,
  botsDialogAtom,
  botsDraftsAtom,
  botsDraftFilesAtom,
  botsErrorAtom,
  botsFileBotIdMapAtom,
  botsFileSessionIdMapAtom,
  botsLoadingAtom,
  botsSnapshotAtom,
  botsWorkspaceSessionIdAtom,
} from '@/atoms/bot-atoms'
import { openBotsConversationAtom } from '@/atoms/bots-navigation'
import { agentPendingFilesAtomFamily, agentSidePanelOpenAtomFamily, agentWorkspacePositionAtom } from '@/atoms/agent-atoms'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { BotAvatar } from './BotAvatar'
import { BotComposer } from './BotComposer'
import { BotConversationMessages } from './BotConversationMessages'
import { BotInteractionBanner } from './BotInteractionBanner'
import { botSelectClassName } from './BotProfileDialog'
import { getBotsAPI } from './useBotsEvents'
import { getBotError, getBotReadableThroughSeq, mergeBotFileReferences } from './bots-state'
import { INSERT_FILE_MENTION_EVENT } from '@/lib/file-panel-drag'
import type { FilePanelDragItem } from '@/lib/file-panel-drag'

export function BotsView(): React.ReactElement {
  const store = useStore()
  const snapshot = useAtomValue(botsSnapshotAtom)
  const state = useAtomValue(botsActiveConversationAtom)
  const activeId = useAtomValue(botsActiveConversationIdAtom)
  const openConversation = useSetAtom(openBotsConversationAtom)
  const [drafts, setDrafts] = useAtom(botsDraftsAtom)
  const [draftFiles, setDraftFiles] = useAtom(botsDraftFilesAtom)
  const [error, setError] = useAtom(botsErrorAtom)
  const loading = useAtomValue(botsLoadingAtom)
  const [fileBotIds, setFileBotIds] = useAtom(botsFileBotIdMapAtom)
  const setFileSessionIds = useSetAtom(botsFileSessionIdMapAtom)
  const workspaceSessionId = useAtomValue(botsWorkspaceSessionIdAtom)
  const [pendingFiles, setPendingFiles] = useAtom(agentPendingFilesAtomFamily(workspaceSessionId ?? ''))
  const [workspacePosition, setWorkspacePosition] = useAtom(agentWorkspacePositionAtom)
  const apply = useSetAtom(botsApplyConversationAtom)
  const setDialog = useSetAtom(botsDialogAtom)
  const [sending, setSending] = React.useState(false)
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [newTitle, setNewTitle] = React.useState('')
  const conversation = state?.conversation
  const memberIds = conversation ? getBotConversationMemberIds(conversation) : []
  const members = memberIds.flatMap((id) => { const bot = snapshot.bots.find((candidate) => candidate.id === id); return bot ? [bot] : [] })
  const availableMembers = members.filter((bot) => !bot.archivedAt)
  const directBot = conversation?.kind === 'direct' ? snapshot.bots.find((bot) => bot.id === conversation.botId) : undefined
  const busy = state?.runs.some((run) => run.state.kind === 'running' || run.state.kind === 'queued') ?? false
  const readableThroughSeq = state ? getBotReadableThroughSeq(state) : 0
  const files = activeId ? draftFiles[activeId] ?? [] : []
  const addFiles = React.useCallback((incoming: BotFileReference[]): void => {
    if (!activeId) return
    setDraftFiles((previous) => ({ ...previous, [activeId]: mergeBotFileReferences(previous[activeId] ?? [], incoming) }))
  }, [activeId, setDraftFiles])
  React.useEffect(() => {
    if (!activeId || !pendingFiles.length) return
    const references = pendingFiles.flatMap((file) => file.sourcePath ? [{ path: file.sourcePath, name: file.filename, isDirectory: false }] : [])
    addFiles(references)
    setPendingFiles([])
  }, [activeId, pendingFiles, addFiles, setPendingFiles])
  React.useEffect(() => {
    const insert = (event: Event): void => {
      const items = (event as CustomEvent<FilePanelDragItem[]>).detail
      if (items?.length) addFiles(items.map(({ path, name, isDirectory }) => ({ path, name, isDirectory })))
    }
    window.addEventListener(INSERT_FILE_MENTION_EVENT, insert)
    return () => window.removeEventListener(INSERT_FILE_MENTION_EVENT, insert)
  }, [addFiles])

  React.useEffect(() => {
    if (!state || !readableThroughSeq || state.conversation.readThroughSeq >= readableThroughSeq) return
    let disposed = false
    const markRead = (): void => {
      if (!document.hasFocus()) return
      void getBotsAPI().markBotConversationRead(state.conversation.id, readableThroughSeq).then((next) => { if (!disposed) apply(next) }).catch(() => undefined)
    }
    markRead()
    window.addEventListener('focus', markRead)
    return () => { disposed = true; window.removeEventListener('focus', markRead) }
  }, [state?.conversation.id, state?.conversation.readThroughSeq, readableThroughSeq, apply])

  const selectFileBot = (botId: string, sessionId?: string): void => {
    if (!state) return
    const epoch = getBotMembershipStart(state.conversation, botId)
    const binding = state.bindings.findLast((item) => item.botId === botId && item.membershipStartedAfterSeq === epoch)
    const resolved = sessionId ?? binding?.sessionId
    setFileBotIds((previous) => ({ ...previous, [state.conversation.id]: botId }))
    if (resolved) setFileSessionIds((previous) => ({ ...previous, [state.conversation.id]: resolved }))
  }
  const send = async (mentionedBotIds: string[]): Promise<void> => {
    if (!activeId || sending) return
    const text = drafts[activeId]?.trim() || (files.length ? '请查看引用的文件。' : '')
    if (!text) return
    setSending(true)
    setError(null)
    try {
      const next = await getBotsAPI().sendBotMessage({ conversationId: activeId, requestId: crypto.randomUUID(), text, mentionedBotIds, files })
      apply(next)
      setDrafts((previous) => ({ ...previous, [activeId]: '' }))
      const sentPaths = new Set(files.map((file) => file.path))
      setDraftFiles((previous) => ({ ...previous, [activeId]: (previous[activeId] ?? []).filter((file) => !sentPaths.has(file.path)) }))
    } catch (failure) { setError(getBotError(failure)) }
    finally { setSending(false) }
  }
  const stop = (runId?: string): void => {
    if (!activeId) return
    void getBotsAPI().stopBotRun({ conversationId: activeId, runId }).catch((failure: unknown) => setError(getBotError(failure)))
  }
  const updateConversation = async (patch: { title?: string; archived?: boolean }): Promise<void> => {
    if (!activeId) return
    try { apply(await getBotsAPI().updateBotConversation({ conversationId: activeId, ...patch })); setRenameOpen(false) }
    catch (failure) { setError(getBotError(failure)) }
  }

  if (loading) return <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载 Bots…</div>
  if (!state && activeId && !error) return <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />打开聊天…</div>
  if (!state) return <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center" data-testid="bots-empty-state"><Bot className="h-10 w-10 text-muted-foreground" /><div><h1 className="text-lg font-medium">与你的 Bot 团队聊天</h1><p className="mt-2 text-sm text-muted-foreground">创建长期角色，保留私聊，或邀请多位 Bot 进入群聊。</p></div>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex gap-2"><Button onClick={() => setDialog({ kind: 'profile' })}><Plus />创建 Bot</Button>{snapshot.bots.some((bot) => !bot.archivedAt) && <Button variant="outline" onClick={() => setDialog({ kind: 'manage' })}>开始私聊</Button>}</div></div>
  const fileBotId = fileBotIds[state.conversation.id] ?? memberIds[0] ?? ''
  const fileBotIsFormer = fileBotId && !memberIds.includes(fileBotId)
  const topics = snapshot.conversations.filter((item) => {
    if (item.conversation.archivedAt) return false
    return conversation?.kind === 'direct' && item.conversation.kind === 'direct' && item.conversation.botId === conversation.botId
  })
  const disabled = Boolean(conversation?.archivedAt) || availableMembers.length === 0
  return <section className="flex h-full min-h-0 flex-col bg-content-area" data-testid="bots-view">
    <header className="flex flex-wrap items-center gap-3 border-b border-border/50 px-5 pb-3 pt-5 titlebar-drag-region">
      <BotAvatar name={directBot?.name ?? state.conversation.title} avatar={directBot?.avatar} group={conversation?.kind === 'group'} />
      <div className="min-w-0 flex-1"><h1 className="truncate text-base font-medium">{state.conversation.title}</h1><p className="truncate text-xs text-muted-foreground">{conversation?.kind === 'group' ? `${members.map((bot) => bot.name).join('、')} · ${conversation.responder.kind === 'mentions' ? '仅点名回应' : conversation.responder.kind === 'everyone' ? '全员回应' : '主持 Bot 回应'}` : directBot?.name ?? '已归档 Bot'}{conversation?.archivedAt ? ' · 聊天已归档' : ''}</p></div>
      <div className="flex items-center gap-1 titlebar-no-drag"><Button variant="ghost" size="sm" disabled={!workspaceSessionId} onClick={() => { if (workspaceSessionId) store.set(agentSidePanelOpenAtomFamily(workspaceSessionId), true) }} data-testid="bot-open-files-button"><FolderOpen />文件</Button><Button variant="ghost" size="icon-sm" aria-label={conversation?.kind === 'group' ? '群聊设置' : 'Bot 设置'} onClick={() => setDialog(conversation?.kind === 'group' ? { kind: 'group', conversationId: conversation.id } : { kind: 'profile', botId: directBot?.id })}><Settings2 /></Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="更多聊天操作"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => { setNewTitle(state.conversation.title); setRenameOpen(true) }}><Pencil className="mr-2 h-4 w-4" />重命名话题</DropdownMenuItem>{directBot && !directBot.archivedAt && <DropdownMenuItem onSelect={() => setDialog({ kind: 'topic', botId: directBot.id })}><Plus className="mr-2 h-4 w-4" />新建话题</DropdownMenuItem>}<DropdownMenuSeparator /><DropdownMenuItem disabled={busy} onSelect={() => { void updateConversation({ archived: !state.conversation.archivedAt }) }}>{state.conversation.archivedAt ? <RotateCcw className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}{state.conversation.archivedAt ? '恢复聊天' : '归档聊天'}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
    </header>
    <div className="flex flex-wrap items-center gap-2 border-b border-border/30 px-5 py-2.5">
      {directBot && <><label className="text-xs text-muted-foreground" htmlFor="bots-topic-select">话题</label><select id="bots-topic-select" className={`${botSelectClassName} max-w-[240px] flex-1`} value={activeId ?? ''} onChange={(event) => openConversation(event.target.value)}>{topics.map((item) => <option key={item.conversation.id} value={item.conversation.id}>{item.conversation.title}</option>)}{state.conversation.archivedAt && <option value={state.conversation.id}>{state.conversation.title} · 已归档</option>}</select><Button size="sm" variant="ghost" disabled={Boolean(directBot.archivedAt)} onClick={() => setDialog({ kind: 'topic', botId: directBot.id })}><Plus />新话题</Button></>}
      {conversation?.kind === 'group' && <><Users className="h-4 w-4 text-muted-foreground" /><label className="text-xs text-muted-foreground" htmlFor="bots-file-member-select">文件工作区</label><select id="bots-file-member-select" className={`${botSelectClassName} max-w-[220px]`} value={fileBotId} onChange={(event) => selectFileBot(event.target.value)}>{members.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}{fileBotIsFormer && <option value={fileBotId}>历史成员 · {snapshot.bots.find((bot) => bot.id === fileBotId)?.name ?? 'Bot'}</option>}</select></>}
      <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="工作区布局"><Columns2 /></Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuRadioGroup value={workspacePosition} onValueChange={(value) => { if (value !== 'center' && value !== 'right') return; setWorkspacePosition(value); if (workspaceSessionId) store.set(agentSidePanelOpenAtomFamily(workspaceSessionId), true) }}><DropdownMenuRadioItem value="right">聊天居中，文件在右</DropdownMenuRadioItem><DropdownMenuRadioItem value="center">文件居中，聊天在右</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu>
      {busy && <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />{state.runs.filter((run) => run.state.kind === 'running').length} 位成员正在工作</span>}
    </div>
    <BotConversationMessages state={state} onStop={stop} onSelectFileBot={selectFileBot} />
    {state.pending.length > 0 && <div className="border-t border-border/30 px-5 py-2 text-xs text-muted-foreground" role="status">{state.pending.length} 条消息排队中：{state.pending[0]?.text.slice(0, 100)}</div>}
    {error && <div role="alert" className="flex items-center gap-2 px-5 py-2 text-sm text-destructive"><span className="flex-1">{error}</span><Button size="sm" variant="ghost" onClick={() => setError(null)}>关闭</Button></div>}
    <BotInteractionBanner state={state} onSelectFileBot={selectFileBot}><BotComposer key={state.conversation.id} files={files} onAddFiles={addFiles} onRemoveFile={(path) => setDraftFiles((previous) => ({ ...previous, [state.conversation.id]: (previous[state.conversation.id] ?? []).filter((file) => file.path !== path) }))} value={drafts[state.conversation.id] ?? ''} onChange={(value) => setDrafts((previous) => ({ ...previous, [state.conversation.id]: value }))} members={availableMembers} busy={busy} sending={sending} disabled={disabled} onSend={send} onStop={() => stop()} /></BotInteractionBanner>
    <Dialog open={renameOpen} onOpenChange={setRenameOpen}><DialogContent><DialogHeader><DialogTitle>重命名话题</DialogTitle></DialogHeader><form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); if (newTitle.trim()) void updateConversation({ title: newTitle.trim() }) }}><Input aria-label="话题名称" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} required maxLength={100} autoFocus /><DialogFooter><Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>取消</Button><Button type="submit" disabled={!newTitle.trim()}>保存</Button></DialogFooter></form></DialogContent></Dialog>
  </section>
}
