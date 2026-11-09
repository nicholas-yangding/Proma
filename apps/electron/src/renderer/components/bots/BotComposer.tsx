import * as React from 'react'
import { AtSign, File, Folder, Loader2, Send, Square, X } from 'lucide-react'
import type { BotDefinition, BotFileReference } from '@proma/shared'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { FILE_PANEL_DRAG_MIME, getFilePanelDragData } from '@/lib/file-panel-drag'

export function BotComposer({ value, onChange, members, files, onAddFiles, onRemoveFile, busy, sending, disabled, onSend, onStop }: {
  value: string
  onChange: (value: string) => void
  members: BotDefinition[]
  files: BotFileReference[]
  onAddFiles: (files: BotFileReference[]) => void
  onRemoveFile: (path: string) => void
  busy: boolean
  sending: boolean
  disabled: boolean
  onSend: (mentionedBotIds: string[]) => Promise<void>
  onStop: () => void
}): React.ReactElement {
  const input = React.useRef<HTMLTextAreaElement>(null)
  const [mentionsOpen, setMentionsOpen] = React.useState(false)
  const [picked, setPicked] = React.useState<string[]>([])
  const [selectedMention, setSelectedMention] = React.useState(0)
  React.useEffect(() => { if (!value) { setPicked([]); setMentionsOpen(false) } }, [value])
  const insert = (bot: BotDefinition): void => {
    const element = input.current
    const position = element?.selectionStart ?? value.length
    const before = value.slice(0, position).replace(/@[^\s@]*$/u, '')
    const text = `${before}@${bot.name} ${value.slice(position)}`
    const caret = before.length + bot.name.length + 2
    onChange(text)
    setPicked((previous) => [...new Set([...previous, bot.id])])
    setMentionsOpen(false)
    requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(caret, caret) })
  }
  const submit = async (): Promise<void> => {
    if ((!value.trim() && !files.length) || sending || disabled) return
    await onSend(picked.filter((id) => members.some((bot) => bot.id === id && value.includes(`@${bot.name}`))))
  }
  return <div className="border-t border-border/50 bg-background/50 px-5 py-4" onDragOver={(event) => { if (!disabled && event.dataTransfer.types.includes(FILE_PANEL_DRAG_MIME)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }} onDrop={(event) => { const items = getFilePanelDragData(event.dataTransfer); if (!items || disabled) return; event.preventDefault(); onAddFiles(items.map(({ path, name, isDirectory }) => ({ path, name, isDirectory }))) }}>
    <div className="mx-auto grid w-full max-w-4xl gap-2.5">
      {files.length > 0 && <div className="flex flex-wrap gap-2" aria-label="待发送文件引用">{files.map((file) => <span key={file.path} className="inline-flex max-w-full items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs" title={file.path}>{file.isDirectory ? <Folder className="h-3 w-3" /> : <File className="h-3 w-3" />}<span className="truncate">{file.name}</span><Button type="button" size="icon-sm" variant="ghost" aria-label={`移除引用${file.name}`} onClick={() => onRemoveFile(file.path)}><X /></Button></span>)}</div>}
      {mentionsOpen && members.length > 0 && <div role="listbox" aria-label="选择提及的 Bot" className="flex flex-wrap gap-1 rounded-lg border border-border bg-popover p-2 shadow-sm">{members.map((bot, index) => <button type="button" role="option" aria-selected={index === selectedMention} key={bot.id} className={`rounded-md px-3 py-1.5 text-sm hover:bg-accent ${index === selectedMention ? 'bg-accent' : ''}`} onClick={() => insert(bot)}>@{bot.name}</button>)}</div>}
      <Textarea ref={input} data-testid="bot-message-input" aria-label="Bot 消息" value={value} disabled={disabled} placeholder={disabled ? '此聊天已归档，恢复后可继续。' : '输入消息，或 @ 指定 Bot。Enter 发送，Shift+Enter 换行。'} rows={3} className="min-h-[82px] resize-none rounded-xl bg-background" onChange={(event) => { onChange(event.target.value); const before = event.target.value.slice(0, event.target.selectionStart); setMentionsOpen(/(?:^|\s)@[^\s@]*$/u.test(before)); setSelectedMention(0) }} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (mentionsOpen && members.length > 0) {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelectedMention((previous) => (previous + (event.key === 'ArrowDown' ? 1 : members.length - 1)) % members.length); return }
          if (event.key === 'Escape') { event.preventDefault(); setMentionsOpen(false); return }
          if (event.key === 'Enter' || event.key === 'Tab') { const bot = members[selectedMention]; if (bot) { event.preventDefault(); insert(bot); return } }
        }
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() }
      }} />
      <div className="flex items-center gap-2"><Button type="button" size="sm" variant="ghost" disabled={disabled || members.length === 0} onClick={() => setMentionsOpen(!mentionsOpen)}><AtSign />提及</Button><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{busy ? '成员正在工作，新消息将排队处理。' : '聊天记录保存在本机。'}</span>{busy && <Button type="button" variant="outline" size="sm" onClick={onStop}><Square />停止全部</Button>}<Button type="button" size="sm" disabled={disabled || sending || (!value.trim() && !files.length)} onClick={() => { void submit() }} data-testid="send-bot-message-button">{sending ? <Loader2 className="animate-spin" /> : <Send />}{busy ? '排队发送' : '发送'}</Button></div>
    </div>
  </div>
}
