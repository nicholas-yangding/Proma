import { parentPort, workerData } from 'node:worker_threads'
import { VaultSearchStore } from '../main/lib/vault-search-store'
import type { VaultWorkerMessage, VaultWorkerQuery } from '../main/lib/vault-search-worker-protocol'

const port = parentPort
if (!port) throw new Error('Vault 搜索 Worker 缺少父线程端口')
const send = (message: VaultWorkerMessage): void => port.postMessage(message)
const store = new VaultSearchStore(workerData as string, (progress) => send({ type: 'changed', progress }))
port.on('message', ({ id, query }: VaultWorkerQuery) => {
  send({ type: 'result', id, progress: store.progress, result: store.search(query) })
})
