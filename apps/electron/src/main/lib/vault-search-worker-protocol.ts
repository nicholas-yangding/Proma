import type { VaultSearchResponse } from '@proma/shared'
import type { VaultIndexProgress } from './vault-search-store'

export interface VaultWorkerQuery {
  id: number
  query: string
}

export type VaultWorkerMessage =
  | { type: 'changed'; progress: VaultIndexProgress }
  | { type: 'result'; id: number; progress: VaultIndexProgress; result: Pick<VaultSearchResponse, 'hits' | 'totalMatches'> }
