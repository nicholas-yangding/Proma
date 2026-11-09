import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import type { BotDefinition, BotModelSelection, PromaPermissionMode } from '@proma/shared'
import { botsResourcesAtom, botsSnapshotAtom } from '@/atoms/bot-atoms'
import { settingsOpenAtom, settingsTabAtom } from '@/atoms/settings-tab'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getBotsAPI } from './useBotsEvents'
import { getBotError } from './bots-state'

export const botSelectClassName = 'h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40'

export function BotProfileDialog({ open, onOpenChange, bot, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bot?: BotDefinition
  onSaved?: (bot: BotDefinition) => void | Promise<void>
}): React.ReactElement {
  const id = React.useId()
  const resources = useAtomValue(botsResourcesAtom)
  const setSnapshot = useSetAtom(botsSnapshotAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const [name, setName] = React.useState('')
  const [avatar, setAvatar] = React.useState('')
  const [instructions, setInstructions] = React.useState('')
  const [workspaceId, setWorkspaceId] = React.useState('')
  const [channelId, setChannelId] = React.useState('')
  const [modelId, setModelId] = React.useState('')
  const [permissionMode, setPermissionMode] = React.useState<PromaPermissionMode>('plan')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!open) return
    setName(bot?.name ?? '')
    setAvatar(bot?.avatar ?? '')
    setInstructions(bot?.instructions ?? '')
    setWorkspaceId(bot?.defaultWorkspaceId ?? '')
    setChannelId(bot?.model.kind === 'fixed' ? bot.model.channelId : '')
    setModelId(bot?.model.kind === 'fixed' ? bot.model.modelId : '')
    setPermissionMode(bot?.permissionMode ?? 'plan')
    setError(null)
  }, [open, bot])
  const channels = resources.channels.filter((channel) => channel.enabled)
  const models = channels.find((channel) => channel.id === channelId)?.models.filter((model) => model.enabled) ?? []
  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!name.trim() || saving) return
    if (channelId && !modelId) { setError('请选择一个模型。'); return }
    setSaving(true)
    setError(null)
    try {
      const model: BotModelSelection = channelId ? { kind: 'fixed', channelId, modelId } : { kind: 'default' }
      const saved = await getBotsAPI().saveBot({ id: bot?.id, name: name.trim(), avatar: avatar.trim(), instructions, model, defaultWorkspaceId: workspaceId, permissionMode })
      setSnapshot((snapshot) => ({ ...snapshot, bots: [...snapshot.bots.filter((item) => item.id !== saved.id), saved] }))
      await onSaved?.(saved)
      onOpenChange(false)
    } catch (failure) { setError(getBotError(failure)) }
    finally { setSaving(false) }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }}>
    <DialogContent className="max-h-[88vh] overflow-y-auto" data-testid="bot-profile-dialog">
      <DialogHeader><DialogTitle>{bot ? '编辑 Bot' : '创建 Bot'}</DialogTitle><DialogDescription>为长期角色设置职责、模型和工作项目。</DialogDescription></DialogHeader>
      <form onSubmit={(event) => { void save(event) }} className="grid gap-4">
        <div className="grid grid-cols-[76px_1fr] gap-3">
          <label className="grid gap-1.5 text-sm" htmlFor={`${id}-avatar`}>头像<Input id={`${id}-avatar`} value={avatar} onChange={(event) => setAvatar(event.target.value)} placeholder="研" maxLength={8} /></label>
          <label className="grid gap-1.5 text-sm" htmlFor={`${id}-name`}>名称<Input id={`${id}-name`} data-testid="bot-name-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：研究员" maxLength={100} required autoFocus /></label>
        </div>
        <label className="grid gap-1.5 text-sm" htmlFor={`${id}-instructions`}>职责指令<Textarea id={`${id}-instructions`} data-testid="bot-instructions-input" value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="负责什么、如何工作、交付什么。" rows={4} maxLength={24000} /></label>
        <label className="grid gap-1.5 text-sm" htmlFor={`${id}-workspace`}>默认项目<select id={`${id}-workspace`} className={botSelectClassName} value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}><option value="">默认受管项目</option>{resources.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
        <label className="grid gap-1.5 text-sm" htmlFor={`${id}-channel`}>模型渠道<select id={`${id}-channel`} data-testid="bot-channel-select" className={botSelectClassName} value={channelId} onChange={(event) => { setChannelId(event.target.value); setModelId('') }}><option value="">跟随应用默认模型</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
        {channelId && <label className="grid gap-1.5 text-sm" htmlFor={`${id}-model`}>模型<select id={`${id}-model`} className={botSelectClassName} value={modelId} onChange={(event) => setModelId(event.target.value)} required><option value="">选择模型</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}</select></label>}
        {channels.length === 0 && <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>发送前需要配置可用模型渠道。</span><Button type="button" size="sm" variant="outline" onClick={() => { onOpenChange(false); setSettingsTab('channels'); setSettingsOpen(true) }}>配置渠道</Button></div>}
        <label className="grid gap-1.5 text-sm" htmlFor={`${id}-permission`}>执行模式<select id={`${id}-permission`} className={botSelectClassName} value={permissionMode} onChange={(event) => setPermissionMode(event.target.value === 'plan' ? 'plan' : 'bypassPermissions')}><option value="plan">计划模式，只读调研</option><option value="bypassPermissions">直接执行，允许使用项目工具</option></select></label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button><Button type="submit" disabled={saving || !name.trim()} data-testid="save-bot-button">{saving ? '保存中…' : bot ? '保存' : '创建 Bot'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
