import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { getBotConversationMemberIds } from '@proma/shared'
import type { BotConversationState, BotResponder } from '@proma/shared'
import { botsApplyConversationAtom, botsResourcesAtom, botsSnapshotAtom } from '@/atoms/bot-atoms'
import { openBotsConversationAtom } from '@/atoms/bots-navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { botSelectClassName } from './BotProfileDialog'
import { getBotsAPI } from './useBotsEvents'
import { getBotError } from './bots-state'

export function BotGroupDialog({ open, onOpenChange, state }: { open: boolean; onOpenChange: (open: boolean) => void; state?: BotConversationState }): React.ReactElement {
  const id = React.useId()
  const snapshot = useAtomValue(botsSnapshotAtom)
  const resources = useAtomValue(botsResourcesAtom)
  const apply = useSetAtom(botsApplyConversationAtom)
  const openConversation = useSetAtom(openBotsConversationAtom)
  const [title, setTitle] = React.useState('')
  const [workspaceId, setWorkspaceId] = React.useState('')
  const [members, setMembers] = React.useState<string[]>([])
  const [responderKind, setResponderKind] = React.useState<'member' | 'mentions' | 'everyone'>('member')
  const [leadBotId, setLeadBotId] = React.useState('')
  const [instructions, setInstructions] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const bots = snapshot.bots.filter((bot) => !bot.archivedAt)
  React.useEffect(() => {
    if (!open) return
    const conversation = state?.conversation
    setTitle(conversation?.title ?? '')
    setWorkspaceId(conversation?.workspaceId ?? '')
    setMembers(conversation ? getBotConversationMemberIds(conversation) : [])
    setInstructions(conversation?.kind === 'group' ? conversation.instructions : '')
    setResponderKind(conversation?.kind === 'group' ? conversation.responder.kind : 'member')
    setLeadBotId(conversation?.kind === 'group' && conversation.responder.kind === 'member' ? conversation.responder.botId : '')
    setError(null)
  }, [open, state?.conversation.id])
  const busy = state?.runs.some((run) => run.state.kind === 'running' || run.state.kind === 'queued') ?? false
  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!title.trim() || members.length === 0 || saving) return
    const lead = members.includes(leadBotId) ? leadBotId : members[0]
    if (!lead) return
    const responder: BotResponder = responderKind === 'member' ? { kind: 'member', botId: lead } : { kind: responderKind }
    setSaving(true)
    setError(null)
    try {
      const next = state
        ? await getBotsAPI().updateBotConversation({ conversationId: state.conversation.id, title: title.trim(), memberBotIds: members, instructions, responder })
        : await getBotsAPI().createBotConversation({ kind: 'group', title: title.trim(), workspaceId, memberBotIds: members, instructions, responder })
      apply(next)
      openConversation(next.conversation.id)
      onOpenChange(false)
    } catch (failure) { setError(getBotError(failure)) }
    finally { setSaving(false) }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }}>
    <DialogContent className="max-h-[88vh] overflow-y-auto" data-testid="bot-group-dialog">
      <DialogHeader><DialogTitle>{state ? '群聊设置' : '创建群聊'}</DialogTitle><DialogDescription>选择长期 Bot，共享当前群的目标与聊天记录。</DialogDescription></DialogHeader>
      <form onSubmit={(event) => { void save(event) }} className="grid gap-4">
        <label className="grid gap-1.5 text-sm" htmlFor={`${id}-title`}>群名称<Input id={`${id}-title`} data-testid="bot-group-name-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：产品研发群" maxLength={100} required autoFocus /></label>
        {!state && <label className="grid gap-1.5 text-sm" htmlFor={`${id}-workspace`}>工作项目<select id={`${id}-workspace`} className={botSelectClassName} value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}><option value="">默认受管项目</option>{resources.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>}
        <fieldset className="grid gap-2" disabled={busy}><legend className="mb-2 text-sm">成员</legend>{bots.length === 0 ? <p className="text-sm text-muted-foreground">先创建至少一位 Bot。</p> : bots.map((bot) => <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent" key={bot.id}><input type="checkbox" checked={members.includes(bot.id)} onChange={(event) => setMembers((previous) => event.target.checked ? [...previous, bot.id] : previous.filter((item) => item !== bot.id))} />{bot.avatar || [...bot.name][0]} {bot.name}</label>)}</fieldset>
        <label className="grid gap-1.5 text-sm" htmlFor={`${id}-responder`}>谁来回应<select id={`${id}-responder`} className={botSelectClassName} value={responderKind} disabled={busy} onChange={(event) => { const value = event.target.value; setResponderKind(value === 'everyone' || value === 'mentions' ? value : 'member') }}><option value="member">主持 Bot 回应</option><option value="mentions">仅被 @ 的成员回应</option><option value="everyone">所有成员回应</option></select></label>
        {responderKind === 'member' && <label className="grid gap-1.5 text-sm" htmlFor={`${id}-lead`}>主持 Bot<select id={`${id}-lead`} className={botSelectClassName} value={members.includes(leadBotId) ? leadBotId : members[0] ?? ''} disabled={busy} onChange={(event) => setLeadBotId(event.target.value)}>{members.map((memberId) => <option key={memberId} value={memberId}>{bots.find((bot) => bot.id === memberId)?.name ?? memberId}</option>)}</select></label>}
        <label className="grid gap-1.5 text-sm" htmlFor={`${id}-instructions`}>群共同指令<Textarea id={`${id}-instructions`} value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={3} maxLength={24000} placeholder="团队目标、交付要求与共同约定。" /></label>
        {busy && <p className="text-xs text-muted-foreground">当前任务结束后可修改成员和回应规则。</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button><Button type="submit" disabled={saving || busy || !title.trim() || members.length === 0} data-testid="save-bot-group-button">{saving ? '保存中…' : state ? '保存群设置' : '创建群聊'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
