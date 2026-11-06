import { useEffect, useState } from 'react'
import { VAULT_SEARCH_MAX_QUERY_LENGTH } from '@proma/shared'
import type { VaultSearchResponse, VaultSearchStatus } from '@proma/shared'

interface SearchState {
  query: string
  response: VaultSearchResponse | null
  loading: boolean
  error: boolean
}

const EMPTY: SearchState = { query: '', response: null, loading: false, error: false }

/** Vault 更新只重新查询索引，不触发已有的会话文件扫描。 */
export function useVaultSearch(enabled: boolean, query: string, submission: number): SearchState {
  const [state, setState] = useState<SearchState>(EMPTY)

  useEffect(() => {
    if (!enabled || !query || query.length > VAULT_SEARCH_MAX_QUERY_LENGTH) {
      setState(EMPTY)
      return
    }
    let disposed = false
    let requestId = 0
    let latest: VaultSearchStatus | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    setState({ query, response: null, loading: true, error: false })

    async function run(): Promise<void> {
      const id = ++requestId
      try {
        const response = await window.electronAPI.searchVaultNotes(query)
        if (disposed || id !== requestId) return
        latest = response.status
        setState({ query, response, loading: false, error: false })
      } catch (error) {
        if (disposed || id !== requestId) return
        console.error('[搜索] Vault 查询失败:', error)
        setState({ query, response: null, loading: false, error: true })
      }
    }

    const unsubscribe = window.electronAPI.onVaultSearchChanged((status) => {
      const switched = latest !== undefined && latest.vaultId !== status.vaultId
      if (!switched && latest && latest.revision >= status.revision && latest.phase === status.phase) return
      latest = status
      clearTimeout(timer)
      if (switched || status.phase === 'error' || status.phase === 'unconfigured') {
        requestId++
        setState({ query, response: { status, hits: [], totalMatches: 0 }, loading: false, error: false })
      }
      if (status.phase === 'ready' || status.phase === 'indexing') timer = setTimeout(() => { void run() }, 120)
    })
    void run()
    return () => {
      disposed = true
      clearTimeout(timer)
      unsubscribe()
    }
  }, [enabled, query, submission])

  if (!enabled || !query || query.length > VAULT_SEARCH_MAX_QUERY_LENGTH) return EMPTY
  return state.query === query ? state : { ...EMPTY, query, loading: true }
}
