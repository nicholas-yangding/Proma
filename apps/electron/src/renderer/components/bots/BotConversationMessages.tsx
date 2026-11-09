import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Check, Copy, Loader2, Square } from 'lucide-react'
import type { BotConversationState, BotRun } from '@proma/shared'
import { agentSessionPathMapAtom } from '@/atoms/agent-atoms'
import { BasePathsProvider, MessageResponse } from '@/components/ai-elements/message'
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation'
import { AgentBrowserLinkProvider } from '@/components/browser/AgentBrowserLinkProvider'
import { FilePathChip } from '@/components/ai-elements/file-path-chip'
import { botsWorkspaceSessionIdAtom } from '@/atoms/bot-atoms'
import { Button } from '@/components/ui/button'
import { copyTextToClipboard } from '@/lib/clipboard'
import { BotAvatar } from './BotAvatar'

const runLabels: Record<BotRun['state']['kind'], string> = {
  queued: '等待执行', running: '正在工作', completed: '已完成', failed: '执行失败', cancelled: '已停止', interrupted: '执行被中断',
}

export function BotConversationMessages({ state, onStop, onSelectFileBot }: {
  state: BotConversationState
  onStop: (runId: string) => void
  onSelectFileBot: (botId: string, sessionId?: string) => void
}): React.ReactElement {
  const paths = useAtomValue(agentSessionPathMapAtom)
  const workspaceSessionId = useAtomValue(botsWorkspaceSessionIdAtom)
  const [copiedId, setCopiedId] = React.useState<string | null>(null)
  const runs = new Map(state.runs.map((run) => [run.id, run]))
  const copy = async (id: string, text: string): Promise<void> => {
    await copyTextToClipboard(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId((previous) => previous === id ? null : previous), 1600)
  }
  return <Conversation className="min-h-0 flex-1" resize="smooth" initial="instant" key={state.conversation.id}>
    <ConversationContent className="mx-auto w-full max-w-4xl gap-5 px-5 py-6">
      {state.messages.length === 0 && <div className="py-14 text-center text-sm text-muted-foreground">{state.conversation.kind === 'group' ? '群聊已就绪。发送消息，或 @ 指定成员。' : '开始一个话题，这里的聊天会持续保留。'}</div>}
      {state.messages.map((message) => {
        if (message.sender.kind === 'system') return <p key={message.id} className="text-center text-xs text-muted-foreground">{message.text}</p>
        const run = message.runId ? runs.get(message.runId) : undefined
        const sender = message.sender
        const busy = run?.state.kind === 'running' || run?.state.kind === 'queued'
        const basePath = message.sessionId ? paths.get(message.sessionId) : undefined
        const body = <BasePathsProvider sessionId={message.sessionId} basePaths={basePath ? [basePath] : undefined}><MessageResponse basePath={basePath}>{message.text}</MessageResponse></BasePathsProvider>
        return <article key={message.id} className={sender.kind === 'user' ? 'ml-auto flex w-full max-w-[90%] flex-row-reverse gap-3' : 'flex w-full gap-3'} data-testid="bot-message" data-bot-id={sender.kind === 'bot' ? sender.botId : undefined} data-run-id={message.runId}>
          <BotAvatar name={sender.kind === 'bot' ? sender.name : '你'} avatar={sender.kind === 'bot' ? sender.avatar : '你'} className="h-8 w-8 rounded-lg text-xs" />
          <div className="min-w-0 flex-1">
            <div className={sender.kind === 'user' ? 'mb-1.5 flex items-center justify-end gap-2 text-xs text-muted-foreground' : 'mb-1.5 flex items-center gap-2 text-xs text-muted-foreground'}><span className="font-medium text-foreground">{sender.kind === 'bot' ? sender.name : '你'}</span><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{busy && <Loader2 className="h-3 w-3 animate-spin" />}</div>
            <div className={sender.kind === 'user' ? 'rounded-xl bg-primary/10 px-4 py-2.5' : 'min-w-0'} onClickCapture={(event) => { if (sender.kind === 'bot' && event.target instanceof Element && event.target.closest('a,button')) onSelectFileBot(sender.botId, message.sessionId) }}>
              {message.text ? message.sessionId ? <AgentBrowserLinkProvider sessionId={message.sessionId}>{body}</AgentBrowserLinkProvider> : body : busy ? <span className="text-sm text-muted-foreground">正在准备回应…</span> : <span className="text-sm text-muted-foreground">没有公开回复。</span>}
              {message.files && message.files.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{message.files.map((file) => {
                const source = state.bindings.find((binding) => binding.sessionId === file.sourceSessionId)
                  ?? state.bindings.findLast((binding) => { const root = paths.get(binding.sessionId); return root && (file.path === root || file.path.startsWith(`${root}/`)) })
                  ?? state.bindings.find((binding) => binding.sessionId === workspaceSessionId)
                return <span key={file.path} title={file.path} onClickCapture={() => { if (source) onSelectFileBot(source.botId, source.sessionId) }}>{file.isDirectory ? <span className="text-xs">📁 {file.name}</span> : <FilePathChip filePath={file.path} sessionId={source?.sessionId} />}</span>
              })}</div>}
            </div>
            {sender.kind === 'bot' && <div className="mt-2 flex min-h-6 items-center gap-2 text-xs text-muted-foreground">
              {run && <span className={run.state.kind === 'failed' ? 'text-destructive' : undefined}>{busy ? run.activity || runLabels[run.state.kind] : runLabels[run.state.kind]}</span>}
              {run?.state.kind === 'failed' && <span className="text-destructive">{run.state.error}</span>}
              {run && busy && <Button size="icon-sm" variant="ghost" aria-label={`停止${sender.name}`} onClick={() => onStop(run.id)}><Square className="h-3 w-3" /></Button>}
              {message.text && <Button size="icon-sm" variant="ghost" aria-label={`复制${sender.name}的回复`} onClick={() => { void copy(message.id, message.text) }}>{copiedId === message.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}</Button>}
            </div>}
          </div>
        </article>
      })}
    </ConversationContent>
    <ConversationScrollButton />
  </Conversation>
}
