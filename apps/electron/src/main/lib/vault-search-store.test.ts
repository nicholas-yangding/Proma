import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultSearchStore } from './vault-search-store'

async function until(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 5_000
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error('等待 Vault 文件监听超时')
    await Bun.sleep(20)
  }
}

test('Given 已索引 Vault When 外部新增、原子覆盖、重命名和删除 Then 检索范围自动更新', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'proma-vault-watch-')))
  const store = new VaultSearchStore(root, () => {})
  try {
    await until(() => store.progress.phase === 'ready')
    mkdirSync(join(root, 'New'))
    const path = join(root, 'New', '外部新增.md')
    writeFileSync(path, '首版关键词')
    await until(() => store.search('首版关键词').totalMatches === 1)
    expect(store.search('首版关键词').hits[0]?.relativePath).toBe('New/外部新增.md')

    const temporary = join(root, 'New', '.atomic.tmp')
    writeFileSync(temporary, '更新后关键词')
    renameSync(temporary, path)
    await until(() => store.search('更新后关键词').totalMatches === 1)
    expect(store.search('首版关键词').totalMatches).toBe(0)

    renameSync(join(root, 'New'), join(root, 'Moved'))
    await until(() => {
      const result = store.search('更新后关键词')
      return result.totalMatches === 1 && result.hits[0]?.relativePath === 'Moved/外部新增.md'
    })
    rmSync(join(root, 'Moved'), { recursive: true })
    await until(() => store.search('更新后关键词').totalMatches === 0)
  } finally {
    await store.close()
    rmSync(root, { recursive: true, force: true })
  }
}, 15_000)

test('Given 隐藏笔记、库外软链接和大文件 When 初始化索引 Then 只检索授权 Markdown 并报告省略数量', async () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'proma-vault-boundary-')))
  const root = join(parent, 'vault')
  mkdirSync(root)
  mkdirSync(join(root, '.obsidian'))
  writeFileSync(join(root, '.obsidian', 'private.md'), '隐藏秘密')
  writeFileSync(join(parent, 'outside.md'), '越界秘密')
  symlinkSync(join(parent, 'outside.md'), join(root, 'outside.md'), 'file')
  writeFileSync(join(root, 'ignored.txt'), '附件秘密')
  writeFileSync(join(root, '大笔记.md'), 'x'.repeat(2 * 1024 * 1024) + '超长正文尾部')
  writeFileSync(join(root, '超过索引上限.md'), '')
  truncateSync(join(root, '超过索引上限.md'), 17 * 1024 * 1024)
  const store = new VaultSearchStore(root, () => {})
  try {
    await until(() => store.progress.phase === 'ready')
    expect(store.progress).toMatchObject({ indexedFiles: 1, skippedFiles: 1 })
    expect(store.search('隐藏秘密').totalMatches).toBe(0)
    expect(store.search('越界秘密').totalMatches).toBe(0)
    expect(store.search('附件秘密').totalMatches).toBe(0)
    expect(store.search('超长正文尾部').hits[0]).toMatchObject({ title: '大笔记', editable: false })

    // 已索引笔记被替换成软链接时，也不能继续返回旧正文或读取链接目标。
    const note = join(root, '大笔记.md')
    rmSync(note)
    symlinkSync(join(parent, 'outside.md'), note, 'file')
    await until(() => store.search('超长正文尾部').totalMatches === 0)
    expect(store.search('越界秘密').totalMatches).toBe(0)
  } finally {
    await store.close()
    rmSync(parent, { recursive: true, force: true })
  }
}, 15_000)
