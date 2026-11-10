/**
 * SearchDialog - 全局搜索 Dialog
 *
 * 浮动搜索面板，支持：
 * - 随输入搜索标题和 Vault；会话正文稍作防抖
 * - 标题匹配 + 消息内容匹配统一渲染，匹配文字高亮
 * - 键盘导航（上下箭头选择 + Enter 打开结果 + Esc 关闭）
 * - 当前模式的会话与当前 Obsidian Vault 分别查询
 *
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Search, X, MessageSquare, Bot, Archive, Loader2, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { searchDialogOpenAtom } from '@/atoms/search-atoms'
import { conversationsAtom, channelsAtom } from '@/atoms/chat-atoms'
import {
  agentSessionsAtom,
  agentWorkspacesAtom,
  agentChannelIdAtom,
  agentPendingPromptAtom,
  currentAgentSessionIdAtom,
  openWorkspaceComponentAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { appModeAtom } from '@/atoms/app-mode'
import { openBotsToolAtom } from '@/atoms/bots-navigation'
import { workspacePanelScopeIdAtom } from '@/atoms/workspace-session'
import { useOpenSession } from '@/hooks/useOpenSession'
import { useCreateSession } from '@/hooks/useCreateSession'
import { productivityToolsAtom, sessionHoverPreviewEnabledAtom } from '@/atoms/ui-preferences'
import { getVaultSessionScope, vaultOpenRequestAtom } from '@/atoms/vault-atoms'
import { useVaultSearch } from '@/hooks/useVaultSearch'
import { selectSearchResultSnapshot, type SearchResultScope } from '@/lib/search-result-snapshot'
import {
  SessionMiniMapPopover,
  useSessionMiniMapHover,
} from '@/components/session-preview/SessionMiniMapPopover'
import type {
  VaultSearchHit,
  VaultSearchStatus,
} from '@proma/shared'
import { findBestSearchMatch, VAULT_SEARCH_MAX_QUERY_LENGTH } from '@proma/shared'

/** 标题搜索结果项 */
interface TitleResult {
  id: string
  title: string
  type: 'chat' | 'agent'
  archived?: boolean
  updatedAt: number
}

/** 内容搜索结果项（统一格式） */
interface ContentResult {
  id: string
  title: string
  type: 'chat' | 'agent'
  messageId: string
  snippet: string
  matchStart: number
  matchLength: number
  archived?: boolean
}

interface VaultResult extends VaultSearchHit {
  type: 'vault'
  vaultId: string
}

type SessionResult = TitleResult | ContentResult
type SearchResult = SessionResult | VaultResult

interface SearchResultSnapshot extends SearchResultScope {
  query: string
  titleResults: TitleResult[]
  contentResults: ContentResult[]
  vaultResults: VaultResult[]
  vaultStatus?: VaultSearchStatus
  vaultTotalMatches?: number
  vaultError: boolean
}

function isContentResult(result: SessionResult): result is ContentResult {
  return 'snippet' in result
}

function resultKey(result: SearchResult): string {
  if (result.type === 'vault') return `vault:${result.vaultId}:${result.relativePath}`
  return `${result.type}:${result.id}:${isContentResult(result) ? result.messageId : 'title'}`
}

/** 高亮文本中的匹配部分 */
function HighlightText({ text, query }: { text: string; query: string }): React.ReactElement {
  const match = findBestSearchMatch(text, query)
  if (!match) return <>{text}</>

  const before = text.slice(0, match.matchStart)
  const matchedText = text.slice(match.matchStart, match.matchStart + match.matchLength)
  const after = text.slice(match.matchStart + match.matchLength)

  return (
    <>
      {before}
      <mark className="bg-primary/20 text-foreground rounded-sm px-0.5">{matchedText}</mark>
      {after}
    </>
  )
}

/** 高亮 snippet 中的匹配部分（使用预计算位置） */
function HighlightSnippet({ snippet, matchStart, matchLength }: {
  snippet: string
  matchStart: number
  matchLength: number
}): React.ReactElement {
  if (matchLength <= 0 || matchStart < 0 || matchStart >= snippet.length) return <>{snippet}</>

  const before = snippet.slice(0, matchStart)
  const match = snippet.slice(matchStart, matchStart + matchLength)
  const after = snippet.slice(matchStart + matchLength)

  return (
    <>
      {before}
      <mark className="bg-primary/20 text-foreground rounded-sm px-0.5">{match}</mark>
      {after}
    </>
  )
}

function SearchResultIcon({ result }: { result: SessionResult }): React.ReactElement {
  return result.type === 'chat' ? (
    <MessageSquare size={14} className="flex-shrink-0 text-foreground/40" />
  ) : (
    <Bot size={14} className="flex-shrink-0 text-blue-500/70" />
  )
}

interface SearchResultRowProps {
  result: SessionResult
  index: number
  isSelected: boolean
  committedQuery: string
  disabled: boolean
  miniMapDisabled?: boolean
  getAgentWorkspaceName: (sessionId: string) => string | undefined
  onSelect: (result: SearchResult) => void
  onHover: (index: number) => void
}

function SearchResultRow({
  result,
  index,
  isSelected,
  committedQuery,
  disabled,
  miniMapDisabled,
  getAgentWorkspaceName,
  onSelect,
  onHover,
}: SearchResultRowProps): React.ReactElement {
  const preview = useSessionMiniMapHover(400, miniMapDisabled)
  const isContent = isContentResult(result)
  const wsName = result.type === 'agent' ? getAgentWorkspaceName(result.id) : undefined

  return (
    <>
      <button
        ref={preview.setAnchorRef}
        data-index={index}
        disabled={disabled}
        onClick={() => onSelect(result)}
        onMouseEnter={() => {
          onHover(index)
          preview.handleMouseEnter()
        }}
        onMouseLeave={preview.handleMouseLeave}
        className={cn(
          'w-full px-4 py-2 text-left transition-colors disabled:pointer-events-none',
          isContent ? 'flex flex-col gap-0.5' : 'flex items-center gap-2.5',
          isSelected
            ? 'bg-primary/10'
            : 'hover:bg-foreground/[0.04]',
          result.archived && 'opacity-60'
        )}
      >
        <div className="flex items-center gap-2.5">
          <SearchResultIcon result={result} />
          <span className="flex-1 min-w-0 truncate text-[13px] text-foreground/80">
            {isContent ? result.title : <HighlightText text={result.title} query={committedQuery} />}
          </span>
          {wsName && (
            <span className="flex-shrink-0 px-1.5 py-0 rounded-full bg-foreground/[0.06] text-[10px] leading-4 text-foreground/40 font-medium truncate max-w-[80px]">
              {wsName}
            </span>
          )}
          {result.archived && (
            <Archive size={12} className="flex-shrink-0 text-foreground/30" />
          )}
        </div>
        {isContent && (
          <div className="pl-[22px] text-[12px] text-foreground/50 truncate">
            <HighlightSnippet
              snippet={result.snippet}
              matchStart={result.matchStart}
              matchLength={result.matchLength}
            />
          </div>
        )}
      </button>
      <SessionMiniMapPopover
        target={{
          type: result.type,
          sessionId: result.id,
          title: result.title,
          workspaceName: wsName,
        }}
        anchorRef={preview.anchorRef}
        open={preview.isOpen}
        isLeaving={preview.isLeaving}
        onMouseEnter={preview.handlePanelMouseEnter}
        onMouseLeave={preview.handlePanelMouseLeave}
      />
    </>
  )
}

export function SearchDialog(): React.ReactElement {
  const [open, setOpen] = useAtom(searchDialogOpenAtom)
  const conversations = useAtomValue(conversationsAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const sessionHoverPreviewEnabled = useAtomValue(sessionHoverPreviewEnabledAtom)
  const agentWorkspaces = useAtomValue(agentWorkspacesAtom)
  const channels = useAtomValue(channelsAtom)
  const selectedMode = useAtomValue(appModeAtom)
  const appMode = selectedMode === 'chat' ? 'chat' : 'agent'
  const currentAgentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const vaultEnabled = useAtomValue(productivityToolsAtom).obsidianEnabled
  const openWorkspaceComponent = useSetAtom(openWorkspaceComponentAtom)
  const openBotsTool = useSetAtom(openBotsToolAtom)
  const workspacePanelScopeId = useAtomValue(workspacePanelScopeIdAtom)
  const requestVaultOpen = useSetAtom(vaultOpenRequestAtom)
  const currentAgentChannelId = useAtomValue(agentChannelIdAtom)
  const setAgentPendingPrompt = useSetAtom(agentPendingPromptAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const openSession = useOpenSession()
  const { createAgent } = useCreateSession()

  const workspaceNameMap = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const w of agentWorkspaces) map.set(w.id, w.name)
    return map
  }, [agentWorkspaces])

  const getAgentWorkspaceName = React.useCallback((sessionId: string): string | undefined => {
    const session = agentSessions.find((s) => s.id === sessionId)
    if (!session?.workspaceId) return undefined
    return workspaceNameMap.get(session.workspaceId)
  }, [agentSessions, workspaceNameMap])

  const [query, setQuery] = React.useState('')
  const [composing, setComposing] = React.useState(false)
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null)
  const [vaultRetry, setVaultRetry] = React.useState(0)
  const [messageResults, setMessageResults] = React.useState<{
    query: string; mode: typeof appMode; rows: ContentResult[]
  } | null>(null)
  const [lastResults, setLastResults] = React.useState<SearchResultSnapshot | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const trimmedQuery = query.trim()
  const queryTooLong = trimmedQuery.length > VAULT_SEARCH_MAX_QUERY_LENGTH
  const hasQuery = open && trimmedQuery.length > 0 && !queryTooLong
  const searchQuery = hasQuery && !composing ? trimmedQuery : ''
  const vaultSearch = useVaultSearch(open && vaultEnabled, searchQuery, vaultRetry)

  const handleClearQuery = (): void => {
    setQuery('')
    setComposing(false)
    setSelectedKey(null)
    setLastResults(null)
    inputRef.current?.focus()
  }

  const matchingTitles = React.useMemo<TitleResult[]>(() => {
    if (!searchQuery) return []
    const sessions = appMode === 'chat' ? conversations : agentSessions
    return sessions
      .filter((session) => findBestSearchMatch(session.title, searchQuery) !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20)
      .map(({ id, title, archived, updatedAt }) => ({ id, title, archived, updatedAt, type: appMode }))
  }, [searchQuery, appMode, conversations, agentSessions])

  React.useEffect(() => {
    setMessageResults(null)
    if (!searchQuery) return
    let disposed = false
    let scanning = false
    const search = appMode === 'chat'
      ? window.electronAPI.searchConversationMessages
      : window.electronAPI.searchAgentSessionMessages
    const timer = setTimeout(async () => {
      scanning = true
      let rows: ContentResult[] = []
      try {
        const hits = await search(searchQuery)
        rows = hits.map((hit) => ({
          id: 'conversationId' in hit ? hit.conversationId : hit.sessionId,
          title: 'conversationTitle' in hit ? hit.conversationTitle : hit.sessionTitle,
          type: appMode,
          messageId: hit.messageId,
          snippet: hit.snippet,
          matchStart: hit.matchStart,
          matchLength: hit.matchLength,
          archived: hit.archived,
        }))
      } catch (error) {
        if (!disposed) console.error('[搜索] 会话正文搜索失败:', error)
      } finally {
        scanning = false
      }
      if (!disposed) setMessageResults({ query: searchQuery, mode: appMode, rows })
    }, 180)
    return () => {
      disposed = true
      clearTimeout(timer)
      if (scanning) void search('').catch(() => {})
    }
  }, [searchQuery, appMode])

  const currentMessages = messageResults?.query === searchQuery && messageResults.mode === appMode ? messageResults : null
  const { response: vaultResponse, loading: vaultLoading, error: vaultError } = vaultSearch
  const currentResults = React.useMemo<SearchResultSnapshot | null>(() => {
    if (!searchQuery || !currentMessages || vaultLoading) return null
    const titleIds = new Set(matchingTitles.map((item) => item.id))
    const vaultId = vaultResponse?.status.vaultId
    return {
      query: searchQuery,
      mode: appMode,
      vaultEnabled,
      titleResults: matchingTitles,
      contentResults: currentMessages.rows.filter((item) => !titleIds.has(item.id)),
      vaultResults: vaultResponse && vaultId
        ? vaultResponse.hits.map((hit) => ({ ...hit, type: 'vault', vaultId }))
        : [],
      vaultStatus: vaultResponse?.status,
      vaultTotalMatches: vaultResponse?.totalMatches,
      vaultError,
    }
  }, [appMode, currentMessages, matchingTitles, searchQuery, vaultEnabled, vaultError, vaultLoading, vaultResponse])

  React.useEffect(() => {
    if (currentResults) {
      setLastResults(currentResults)
    } else if (!open || !trimmedQuery) {
      setLastResults(null)
    }
  }, [currentResults, open, trimmedQuery])

  const displayedResults = selectSearchResultSnapshot({
    hasQuery, mode: appMode, vaultEnabled, current: currentResults, previous: lastResults,
  })
  const canOpenResults = currentResults !== null
  const vaultStatus = displayedResults?.vaultStatus
  const { titleResults = [], contentResults = [], vaultResults = [] } = displayedResults ?? {}

  const handleAgentSearch = React.useCallback(async () => {
    const q = query.trim()
    if (!q) return

    const deepseekChannel = channels.find(
      (c) => c.enabled && c.models.some((m) => m.id === 'deepseek-v4-flash' && m.enabled)
    )
    const channelId = deepseekChannel?.id ?? currentAgentChannelId ?? undefined

    const configDir = import.meta.env.DEV ? '.proma-dev' : '.proma'
    const prompt = `请帮我在 Proma 的全部会话历史中搜索与以下描述相关的内容：

"${q}"

搜索范围：
- Chat 会话消息文件：~/${configDir}/conversations/ 目录下所有 .jsonl 文件
- Agent 会话消息文件：~/${configDir}/agent-sessions/ 目录下所有 .jsonl 文件

要求：
1. 理解用户描述的语义，不要求关键词完全匹配，根据内容相关性判断
2. 找到相关会话后，给出会话标题、相关内容摘要，以及文件路径
3. 按相关性排序，最相关的结果排在最前面`

    const sessionId = await createAgent({ channelId })
    if (!sessionId) return

    setAgentPendingPrompt({ sessionId, message: prompt })
    setOpen(false)
    setActiveView('conversations')
  }, [query, channels, currentAgentChannelId, createAgent, setAgentPendingPrompt, setOpen, setActiveView])

  const allResults = React.useMemo<SearchResult[]>(
    () => displayedResults
      ? [...displayedResults.titleResults, ...displayedResults.vaultResults, ...displayedResults.contentResults]
      : [],
    [displayedResults],
  )
  const selectedIndex = Math.max(0, allResults.findIndex((result) => resultKey(result) === selectedKey))
  React.useEffect(() => {
    if (!selectedKey || !allResults.some((result) => resultKey(result) === selectedKey)) {
      setSelectedKey(allResults[0] ? resultKey(allResults[0]) : null)
    }
  }, [allResults, selectedKey])
  const selectIndex = React.useCallback((index: number): void => {
    const result = allResults[index]
    if (result) setSelectedKey(resultKey(result))
  }, [allResults])

  const navigateToResult = React.useCallback((result: SearchResult) => {
    if (!canOpenResults) return
    if (result.type === 'vault') {
      if (!result.editable) {
        toast.info('这篇笔记超过 Vault 编辑器的 2 MB 上限，仍可检索正文')
        return
      }
      const sessionId = selectedMode === 'agent' ? currentAgentSessionId : null
      const vaultScope = selectedMode === 'bots' ? workspacePanelScopeId : sessionId
      requestVaultOpen({ scope: getVaultSessionScope(vaultScope ?? undefined), vaultId: result.vaultId, relativePath: result.relativePath })
      setOpen(false)
      if (selectedMode === 'bots') {
        openBotsTool('vault')
        return
      }
      setActiveView(sessionId ? 'conversations' : 'vault')
      if (sessionId) openWorkspaceComponent({ scopeId: sessionId, component: 'vault' })
      return
    }
    setOpen(false)
    setActiveView('conversations')

    if (result.type === 'chat') {
      const conv = conversations.find((c) => c.id === result.id)
      const title = conv?.title ?? result.title
      openSession('chat', result.id, title)
    } else {
      const session = agentSessions.find((s) => s.id === result.id)
      const title = session?.title ?? result.title
      openSession('agent', result.id, title)
    }
  }, [selectedMode, canOpenResults, currentAgentSessionId, requestVaultOpen, openBotsTool, openWorkspaceComponent, workspacePanelScopeId, setOpen, setActiveView, openSession, conversations, agentSessions])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (composing || e.nativeEvent.isComposing || !canOpenResults) return
    if (e.key === 'Enter') {
      e.preventDefault()
      const result = allResults[selectedIndex]
      if (result) navigateToResult(result)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      selectIndex(Math.min(selectedIndex + 1, allResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      selectIndex(Math.max(selectedIndex - 1, 0))
    }
  }, [canOpenResults, composing, allResults, selectedIndex, selectIndex, navigateToResult])

  // 自动滚动选中项到可视区域
  React.useEffect(() => {
    const list = listRef.current
    if (!list) return
    const selected = list.querySelector(`[data-index="${selectedIndex}"]`)
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex, selectedKey])

  React.useEffect(() => {
    if (!open) {
      setQuery('')
      setComposing(false)
      setSelectedKey(null)
      return
    }
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(focusTimer)
  }, [open])

  const isSearching = hasQuery && !composing
    && (!currentResults || vaultStatus?.phase === 'indexing')

  return (
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      {/* 非交互式背景遮罩：modal=false 时 Radix 不渲染原生 overlay（避免拦截 hover 预览的事件），
       * 这里手动通过 DialogPortal 在 document.body 渲染一个 pointer-events-none 的 blur 层——
       * Portal 是关键：直接渲染会被父级 stacking context（如 MainContentPanel）困住，导致只覆盖到
       * 左侧栏；用 Portal 后 fixed inset-0 真正覆盖整个视口。
       * z-[99] 在 DialogContent (z-[100]) 之下，在所有 app 内容之上。
       */}
      {open && (
        <DialogPortal>
          <div
            aria-hidden
            className="fixed inset-0 z-[99] bg-black/40 pointer-events-none animate-in fade-in-0 duration-150"
          />
        </DialogPortal>
      )}
      <DialogContent
        hideClose
        className="w-[min(56rem,calc(100vw_-_2rem))] max-w-[calc(100vw_-_2rem)] p-0 gap-0 overflow-hidden"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">全局搜索</DialogTitle>
        {/* 搜索输入框 */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50">
          <Search size={16} className="text-foreground/40 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => {
              setQuery(event.currentTarget.value)
              setComposing(false)
            }}
            onKeyDown={handleKeyDown}
            placeholder={vaultEnabled ? '搜索会话和 Obsidian Vault' : '搜索会话'}
            aria-label="全局搜索关键词"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground placeholder:text-foreground/40 outline-none"
          />
          <button
            type="button"
            onClick={handleClearQuery}
            title="清空"
            disabled={!query}
            className={cn(
              'shrink-0 rounded p-0.5 text-foreground/30 transition-colors hover:text-foreground/60',
              !query && 'invisible',
            )}
          >
            <X size={14} />
          </button>
          {isSearching
            ? <Loader2 size={14} className="shrink-0 animate-spin text-foreground/40" aria-label="搜索中" />
            : <span className="size-3.5 shrink-0" aria-hidden />}
          <button
            onClick={() => void handleAgentSearch()}
            disabled={composing || queryTooLong || trimmedQuery.length < 2}
            title="适合在精准搜索找不到的情况下使用，Agent 会帮助你搜索整个 Proma 会话空间"
            className={cn(
              'flex shrink-0 items-center gap-1 px-2 py-1 rounded text-[12px] font-medium transition-colors',
              !composing && !queryTooLong && trimmedQuery.length >= 2
                ? 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20'
                : 'bg-foreground/[0.06] text-foreground/30 cursor-not-allowed'
            )}
          >
            <Bot size={12} />
            <span>Agent 搜索</span>
          </button>
        </div>

        {/* 搜索结果 */}
        <div className="relative">
          <div ref={listRef} aria-busy={hasQuery && !canOpenResults} className="h-[min(400px,55dvh)] overflow-y-auto scrollbar-thin">
          {!hasQuery && (
            <div className="py-12 text-center text-[13px] text-foreground/40">
              {queryTooLong ? `关键词不能超过 ${VAULT_SEARCH_MAX_QUERY_LENGTH} 个字符` : '输入关键词即可搜索'}
            </div>
          )}

          {hasQuery && !displayedResults && (
            <div className="py-12 text-center text-[13px] text-foreground/40">
              {composing ? '等待输入完成…' : '正在搜索…'}
            </div>
          )}

          {displayedResults && allResults.length === 0 && !displayedResults.vaultError
            && vaultStatus?.phase !== 'error' && vaultStatus?.phase !== 'indexing' && (
            <div className="py-8 flex flex-col items-center gap-3 text-[13px] text-foreground/40">
              <span>未找到匹配结果</span>
              <button
                onClick={() => void handleAgentSearch()}
                disabled={searchQuery.length < 2}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors disabled:pointer-events-none disabled:opacity-50"
              >
                <Bot size={12} />
                <span>试试 Agent 搜索</span>
              </button>
            </div>
          )}

          {/* 标题匹配区域 */}
          {titleResults.length > 0 && (
            <div className="py-1">
              <div className="px-4 pt-2 pb-1 text-[11px] font-medium text-foreground/40 select-none">
                标题匹配
              </div>
              {titleResults.map((result, idx) => (
                <SearchResultRow
                  key={`title-${result.id}`}
                  result={result}
                  index={idx}
                  isSelected={selectedIndex === idx}
                  committedQuery={displayedResults?.query ?? ''}
                  disabled={!canOpenResults}
                  miniMapDisabled={!canOpenResults || !sessionHoverPreviewEnabled}
                  getAgentWorkspaceName={getAgentWorkspaceName}
                  onSelect={navigateToResult}
                  onHover={selectIndex}
                />
              ))}
            </div>
          )}

          {displayedResults?.vaultEnabled && (
            <div className="py-1 border-t border-border/30" aria-label="Obsidian 文档结果">
              <div className="px-4 pt-2 pb-1 flex items-center gap-2 text-[11px] font-medium text-foreground/50">
                <span>Obsidian 文档{vaultStatus?.displayName ? ` · ${vaultStatus.displayName}` : ''}</span>
                {vaultResults.length > 0 && <span>{vaultResults.length} / {displayedResults.vaultTotalMatches}</span>}
                {vaultStatus?.phase === 'indexing' && <Loader2 size={12} className="animate-spin" />}
              </div>
              {(vaultStatus?.phase === 'indexing' || vaultStatus?.phase === 'unconfigured'
                || displayedResults.vaultError || vaultStatus?.phase === 'error' || !!vaultStatus?.skippedFiles
                || (vaultStatus?.phase === 'ready' && vaultResults.length === 0)) && (
                <div role="status" className="px-4 pb-2 text-[12px] text-foreground/50">
                  {displayedResults.vaultError || vaultStatus?.phase === 'error' ? 'Vault 搜索暂时不可用，请重试。'
                    : vaultStatus?.phase === 'unconfigured' ? '先打开一个 Obsidian Vault，即可搜索笔记。'
                    : vaultStatus?.phase === 'indexing' ? `正在索引笔记 · 已处理 ${vaultStatus.indexedFiles} 篇`
                    : vaultStatus?.skippedFiles ? `${vaultStatus.skippedFiles} 篇笔记过大或无法读取，未纳入索引。`
                    : '当前 Vault 没有匹配的笔记。'}
                  {(displayedResults.vaultError || vaultStatus?.phase === 'error') && (
                    <button type="button" disabled={!canOpenResults} className="ml-2 text-primary underline" onClick={() => setVaultRetry((value) => value + 1)}>重试</button>
                  )}
                </div>
              )}
              {vaultResults.map((result, i) => {
                const index = titleResults.length + i
                return (
                  <button
                    key={resultKey(result)}
                    data-index={index}
                    disabled={!canOpenResults}
                    onClick={() => navigateToResult(result)}
                    onMouseEnter={() => selectIndex(index)}
                    className={cn('w-full flex items-start gap-2.5 px-4 py-2 text-left disabled:pointer-events-none',
                      index === selectedIndex ? 'bg-primary/10' : 'hover:bg-foreground/[0.04]')}
                  >
                    <FileText size={14} className="mt-0.5 shrink-0 text-primary/70" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[13px] font-medium text-foreground">{result.title}</span>
                      {result.snippet && <span className="truncate text-[12px] text-foreground/60">
                        <HighlightSnippet snippet={result.snippet} matchStart={result.matchStart} matchLength={result.matchLength} />
                      </span>}
                      <span className="truncate text-[11px] text-foreground/40">{result.relativePath}{result.editable ? '' : ' · 超出编辑器上限'}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {/* 内容匹配区域 */}
          {contentResults.length > 0 && (
            <div className="py-1 border-t border-border/30">
              <div className="px-4 pt-2 pb-1 flex items-center gap-2 text-[11px] font-medium text-foreground/40 select-none">
                <span>消息内容匹配</span>
              </div>
              {contentResults.map((result, i) => (
                <SearchResultRow
                  key={`content-${result.id}-${result.messageId}`}
                  result={result}
                index={titleResults.length + vaultResults.length + i}
                isSelected={selectedIndex === titleResults.length + vaultResults.length + i}
                  committedQuery={displayedResults?.query ?? ''}
                  disabled={!canOpenResults}
                  miniMapDisabled={!canOpenResults || !sessionHoverPreviewEnabled}
                  getAgentWorkspaceName={getAgentWorkspaceName}
                  onSelect={navigateToResult}
                  onHover={selectIndex}
                />
              ))}
            </div>
          )}
          </div>
        </div>

        {/* 底部快捷键提示 */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-border/30 text-[11px] text-foreground/30">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-foreground/[0.06] font-mono">↵</kbd>
            <span>打开</span>
          </span>
          {allResults.length > 0 && (
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-foreground/[0.06] font-mono">↑↓</kbd>
              <span>选择</span>
            </span>
          )}
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-foreground/[0.06] font-mono">Esc</kbd>
            <span>关闭</span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
