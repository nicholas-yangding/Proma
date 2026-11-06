import type { FileIndexEntry } from '@proma/shared'

/**
 * 把「文件窗口区当前打开的文件」置顶为 pinned 条目。
 * 空 query 恒置顶；有 query 时仅当文件名或路径匹配才置顶。
 * 结果集中同绝对路径的条目去重，避免 pinned 与树内条目重复。
 */
export function pinCurrentFileEntry(
  entries: FileIndexEntry[],
  currentFilePath: string | null | undefined,
  query: string,
): { entries: FileIndexEntry[]; pinnedEntry?: FileIndexEntry } {
  if (!currentFilePath) return { entries }
  const normalizedCurrent = currentFilePath.replace(/\\/g, '/').toLowerCase()
  const loweredQuery = (query ?? '').trim().toLowerCase()
  // 展示名保留原始大小写；匹配与去重用归一化路径。
  const name = currentFilePath.slice(currentFilePath.replace(/\\/g, '/').lastIndexOf('/') + 1)
  if (loweredQuery && !name.toLowerCase().includes(loweredQuery) && !normalizedCurrent.includes(loweredQuery)) {
    return { entries }
  }
  const deduped = entries.filter((entry) => entry.path.replace(/\\/g, '/').toLowerCase() !== normalizedCurrent)
  return {
    entries: deduped,
    pinnedEntry: { name, path: currentFilePath, type: 'file', source: 'workspace' },
  }
}
