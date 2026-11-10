import { describe, expect, test } from 'bun:test'
import type { FileIndexEntry } from '@proma/shared'
import { loadCurrentFileMention } from './current-open-file'
import type { CurrentOpenFile } from './current-open-file'

const vaultFile: CurrentOpenFile = { kind: 'vault', vaultId: 'vault-a', relativePath: 'Inbox/当前笔记.md' }

describe('当前文件引用查询', () => {
  test('Given Vault 当前笔记不在项目搜索结果中，When 查询并解析，Then 置顶该笔记并沿用过滤规则', async () => {
    const currentFileRef = { current: vaultFile }
    const load = (query: string) => loadCurrentFileMention({ currentFileRef, query, searchFiles: async () => [], resolveVaultFile: async () => '/vault/Inbox/当前笔记.md' })
    expect((await load('')).pinnedEntry?.path).toBe('/vault/Inbox/当前笔记.md')
    expect((await load('当前')).pinnedEntry?.name).toBe('当前笔记.md')
    expect((await load('其他')).pinnedEntry).toBeUndefined()
  })

  test('Given 同一文件已在搜索中，When 当前文档置顶，Then 去重并保留其余文件', async () => {
    const entries: FileIndexEntry[] = [
      { name: '当前笔记.md', path: '/vault/Inbox/当前笔记.md', type: 'file', source: 'workspace' },
      { name: 'app.ts', path: '/project/app.ts', type: 'file', source: 'workspace' },
    ]
    const result = await loadCurrentFileMention({ currentFileRef: { current: vaultFile }, query: '', searchFiles: async () => entries, resolveVaultFile: async () => '/vault/Inbox/当前笔记.md' })
    expect(result.entries.map((entry) => entry.path)).toEqual(['/project/app.ts'])
    expect(result.pinnedEntry?.path).toBe('/vault/Inbox/当前笔记.md')
  })

  test('Given 普通预览，When 查询，Then 不调用 Vault 解析且仍置顶预览', async () => {
    const result = await loadCurrentFileMention({
      currentFileRef: { current: { kind: 'preview', path: '/project/app.ts' } },
      query: '',
      searchFiles: async () => [],
      resolveVaultFile: async () => { throw new Error('普通文件不应调用 Vault') },
    })
    expect(result.pinnedEntry?.path).toBe('/project/app.ts')
  })

  test('Given 解析已完成但文件搜索仍在等待，When 用户切换笔记或 Pane，Then 不发布旧文件 pin', async () => {
    const currentFileRef: { current: CurrentOpenFile | null } = { current: vaultFile }
    const search = Promise.withResolvers<FileIndexEntry[]>()
    const pending = loadCurrentFileMention({ currentFileRef, query: '', searchFiles: () => search.promise, resolveVaultFile: async () => '/vault/Inbox/当前笔记.md' })
    await Promise.resolve()
    currentFileRef.current = { kind: 'preview', path: '/project/app.ts' }
    search.resolve([])
    expect((await pending).pinnedEntry).toBeUndefined()
  })

  test('Given Vault 已撤销或解析失败，When 查询，Then 保留普通搜索结果且不回退到旧预览', async () => {
    const result = await loadCurrentFileMention({ currentFileRef: { current: vaultFile }, query: '', searchFiles: async () => [], resolveVaultFile: async () => null })
    expect(result.pinnedEntry).toBeUndefined()
  })

  test('Given 旧 Vault 解析仍在等待，When 新 Vault 打开同相对路径，Then 不置顶旧 Vault 路径', async () => {
    const currentFileRef: { current: CurrentOpenFile | null } = { current: vaultFile }
    const resolution = Promise.withResolvers<string | null>()
    const pending = loadCurrentFileMention({ currentFileRef, query: '', searchFiles: async () => [], resolveVaultFile: () => resolution.promise })
    currentFileRef.current = { kind: 'vault', vaultId: 'vault-b', relativePath: 'Inbox/当前笔记.md' }
    resolution.resolve('/old-vault/Inbox/当前笔记.md')
    expect((await pending).pinnedEntry).toBeUndefined()
  })

  test('Given 引用解析抛错但项目搜索成功，When 查询，Then 仍返回项目搜索结果', async () => {
    const entries: FileIndexEntry[] = [{ name: 'app.ts', path: '/project/app.ts', type: 'file', source: 'workspace' }]
    const result = await loadCurrentFileMention({ currentFileRef: { current: vaultFile }, query: '', searchFiles: async () => entries, resolveVaultFile: async () => { throw new Error('Vault 已不可用') } })
    expect(result.entries).toEqual(entries)
    expect(result.pinnedEntry).toBeUndefined()
  })
})
