import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { VAULT_IPC_CHANNELS, VAULT_SEARCH_MAX_QUERY_LENGTH } from '@proma/shared'
import type { VaultSearchResponse, VaultSearchStatus } from '@proma/shared'
import { getMainWindow } from './main-window-store'
import { getVaultConfig, getVaultId } from './vault-service'
import type { VaultWorkerMessage, VaultWorkerQuery } from './vault-search-worker-protocol'

type WorkerResult = Extract<VaultWorkerMessage, { type: 'result' }>

interface VaultWorkerScope {
  root: string
  worker: Worker
  status: VaultSearchStatus
  pending: Map<number, (response?: WorkerResult) => void>
}

const UNCONFIGURED: VaultSearchStatus = {
  vaultId: null, displayName: null, phase: 'unconfigured', revision: 0, indexedFiles: 0, skippedFiles: 0,
}
let current: VaultWorkerScope | undefined
let sequence = 0

function publish(status: VaultSearchStatus): void {
  const window = getMainWindow()
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send(VAULT_IPC_CHANNELS.SEARCH_CHANGED, status)
  }
}

function empty(status = current?.status ?? UNCONFIGURED): VaultSearchResponse {
  return { status, hits: [], totalMatches: 0 }
}

export function stopVaultSearch(): void {
  const scope = current
  current = undefined
  if (!scope) return
  for (const finish of scope.pending.values()) finish()
  void scope.worker.terminate().catch(() => {})
}

function fail(scope: VaultWorkerScope): void {
  if (current !== scope || scope.status.phase === 'error') return
  scope.status = { ...scope.status, phase: 'error' }
  for (const finish of scope.pending.values()) finish()
  publish(scope.status)
}

function ensureCurrent(retry = false): VaultWorkerScope | undefined {
  const config = getVaultConfig()
  if (!config) {
    if (current) { stopVaultSearch(); publish(UNCONFIGURED) }
    return undefined
  }
  if (current?.root === config.rootPath && (!retry || current.status.phase !== 'error')) return current

  stopVaultSearch()
  const worker = new Worker(join(__dirname, 'vault-search-worker.cjs'), {
    workerData: config.rootPath,
    resourceLimits: { maxOldGenerationSizeMb: 512 },
  })
  const scope: VaultWorkerScope = {
    root: config.rootPath, worker, pending: new Map(),
    status: { ...UNCONFIGURED, vaultId: getVaultId(config.rootPath), displayName: config.displayName, phase: 'indexing' },
  }
  current = scope
  worker.on('message', (message: VaultWorkerMessage) => {
    if (current !== scope) return
    scope.status = { ...scope.status, ...message.progress }
    if (message.type === 'changed') publish(scope.status)
    else scope.pending.get(message.id)?.(message)
  })
  worker.on('error', (error) => {
    console.error('[Vault 搜索] 索引 Worker 失败:', error)
    fail(scope)
  })
  worker.on('exit', () => fail(scope))
  publish(scope.status)
  return scope
}

export function warmVaultSearch(): void {
  try { ensureCurrent() } catch (error) { console.error('[Vault 搜索] 无法启动索引:', error) }
}

export async function searchVaultNotes(query: unknown): Promise<VaultSearchResponse> {
  if (typeof query !== 'string' || query.length > VAULT_SEARCH_MAX_QUERY_LENGTH) throw new Error('Vault 搜索关键词非法或过长')
  const scope = ensureCurrent(true)
  if (!scope) return empty()

  const id = ++sequence
  const reply = await new Promise<WorkerResult | undefined>((resolve) => {
    const finish = (result?: WorkerResult): void => {
      clearTimeout(timer)
      scope.pending.delete(id)
      resolve(result)
    }
    const timer = setTimeout(() => {
      fail(scope)
      void scope.worker.terminate().catch(() => {})
      finish()
    }, 15_000)
    scope.pending.set(id, finish)
    try {
      scope.worker.postMessage({ id, query } satisfies VaultWorkerQuery)
    } catch {
      fail(scope)
      finish()
    }
  })
  // Vault 授权发生变化后，旧线程返回的相同相对路径也不可被使用。
  if (ensureCurrent() !== scope || !reply) return empty()
  return { ...reply.result, status: { ...scope.status, ...reply.progress } }
}
