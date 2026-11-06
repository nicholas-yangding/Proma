import type { AppMode } from '../atoms/app-mode'

export interface SearchResultScope {
  mode: AppMode
  vaultEnabled: boolean
}

interface SearchResultSnapshotInput<T extends SearchResultScope> extends SearchResultScope {
  hasQuery: boolean
  current: T | null
  previous: T | null
}

export function selectSearchResultSnapshot<T extends SearchResultScope>({
  mode,
  vaultEnabled,
  hasQuery,
  current,
  previous,
}: SearchResultSnapshotInput<T>): T | null {
  if (!hasQuery) return null
  if (current) return current
  return previous?.mode === mode && previous.vaultEnabled === vaultEnabled ? previous : null
}
