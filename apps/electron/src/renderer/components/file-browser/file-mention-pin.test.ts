import { describe, expect, test } from 'bun:test'
import type { FileIndexEntry } from '@proma/shared'
import { pinCurrentFileEntry } from './file-mention-pin'

function entry(path: string, name?: string): FileIndexEntry {
  return { name: name ?? path.slice(path.lastIndexOf('/') + 1), path, type: 'file', source: 'workspace' }
}

describe('Given 文件窗口区已打开文件 When @ 联想置顶', () => {
  const current = '/Users/x/proj/src/app.tsx'

  test('Then 空 query 恒置顶并从结果集去重同路径条目', () => {
    const entries = [entry(current), entry('/Users/x/proj/src/other.ts')]
    const result = pinCurrentFileEntry(entries, current, '')
    expect(result.pinnedEntry).toMatchObject({ name: 'app.tsx', path: current, type: 'file' })
    expect(result.entries.map((e) => e.path)).toEqual(['/Users/x/proj/src/other.ts'])
  })

  test('Then query 匹配文件名时置顶，不匹配时不置顶', () => {
    expect(pinCurrentFileEntry([], current, 'app').pinnedEntry?.name).toBe('app.tsx')
    expect(pinCurrentFileEntry([], current, 'zzz').pinnedEntry).toBeUndefined()
    const matchByPath = pinCurrentFileEntry([], current, 'proj/src')
    expect(matchByPath.pinnedEntry?.name).toBe('app.tsx')
  })

  test('Then 未打开文件时行为不变（pinned 缺省、entries 原样）', () => {
    const entries = [entry('/a.md'), entry('/b.md')]
    const result = pinCurrentFileEntry(entries, null, '')
    expect(result.pinnedEntry).toBeUndefined()
    expect(result.entries).toBe(entries)
  })

  test('Then 路径比较大小写与分隔符不敏感', () => {
    const entries = [entry('/Users/x/Proj/SRC/APP.TSX')]
    const result = pinCurrentFileEntry(entries, current, '')
    expect(result.entries).toHaveLength(0)
    expect(result.pinnedEntry?.path).toBe(current)
  })
})
