import * as React from 'react'
import { useSetAtom } from 'jotai'
import type { BotDefinition } from '@proma/shared'
import { botsActiveConversationIdAtom, botsApplyConversationAtom } from '@/atoms/bot-atoms'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getBotsAPI } from './useBotsEvents'
import { getBotError } from './bots-state'

export function BotTopicDialog({ bot, open, onOpenChange }: { bot: BotDefinition; open: boolean; onOpenChange: (open: boolean) => void }): React.ReactElement {
  const id = React.useId()
  const [title, setTitle] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const apply = useSetAtom(botsApplyConversationAtom)
  const setActive = useSetAtom(botsActiveConversationIdAtom)
  React.useEffect(() => { if (open) { setTitle(''); setError(null) } }, [open, bot.id])
  const create = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      const state = await getBotsAPI().createBotConversation({ kind: 'direct', botId: bot.id, title: title.trim(), workspaceId: bot.defaultWorkspaceId })
      apply(state)
      setActive(state.conversation.id)
      onOpenChange(false)
    } catch (failure) { setError(getBotError(failure)) }
    finally { setSaving(false) }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader><DialogTitle>与 {bot.name} 新建话题</DialogTitle><DialogDescription>保留已有聊天，新话题使用独立上下文。</DialogDescription></DialogHeader>
    <form onSubmit={(event) => { void create(event) }} className="grid gap-4">
      <label htmlFor={id} className="grid gap-1.5 text-sm">话题名称<Input id={id} data-testid="bot-topic-name-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：下一季度产品规划" maxLength={100} required autoFocus /></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button><Button type="submit" disabled={saving || !title.trim()}>新建话题</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>
}
