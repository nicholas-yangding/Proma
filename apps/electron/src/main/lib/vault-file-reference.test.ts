import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { VaultFileReferenceInput } from '@proma/shared'
import { writeJsonFileAtomic } from './safe-file'
import { createVaultFileSystem, getVaultId } from './vault-service'

const modulePath = join(import.meta.dir, 'vault-service.ts')

function fixture(): { parent: string; root: string; home: string } {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'proma-vault-reference-')))
  const root = join(parent, 'vault')
  const home = join(parent, 'home')
  mkdirSync(root)
  mkdirSync(join(home, '.proma-dev'), { recursive: true })
  writeFileSync(join(root, '当前笔记.md'), '# 已授权笔记')
  configure(home, root)
  return { parent, root, home }
}

function configure(home: string, root: string): void {
  writeJsonFileAtomic(join(home, '.proma-dev/vault.json'), { rootPath: root, displayName: '测试 Vault', inboxPath: 'Inbox', allowAgentWrites: false, configuredAt: 1 })
}

function resolveReference(home: string, input: VaultFileReferenceInput): unknown {
  const script = `import { resolveVaultFileReference } from ${JSON.stringify(modulePath)}; process.stdout.write(JSON.stringify(resolveVaultFileReference(JSON.parse(process.argv[1]))))`
  const result = Bun.spawnSync({ cmd: [process.execPath, '--eval', script, JSON.stringify(input)], env: { ...process.env, HOME: home, PROMA_DEV: '1' }, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  const output = result.stdout.toString().trim().split('\n').at(-1)
  if (!output) throw new Error('缺少引用解析结果')
  return JSON.parse(output)
}

describe('已授权 Vault 的单文件引用', () => {
  test('Given 成功读取笔记，When 获取文档身份并解析引用，Then 返回同一已授权文件', () => {
    const { parent, root, home } = fixture()
    try {
      const read = createVaultFileSystem(root).readFile('当前笔记.md')
      expect(read.vaultId).toBe(getVaultId(root))
      expect(resolveReference(home, { vaultId: getVaultId(root), relativePath: read.relativePath })).toBe(join(root, '当前笔记.md'))
    } finally { rmSync(parent, { recursive: true, force: true }) }
  })

  test('Given 配置换到具有同名笔记的另一个 Vault，When 使用旧文档身份，Then 不引用新 Vault 的同名文件', () => {
    const { parent, root, home } = fixture()
    try {
      const other = join(parent, 'other')
      mkdirSync(other)
      writeFileSync(join(other, '当前笔记.md'), '# 另一个 Vault')
      configure(home, other)
      expect(resolveReference(home, { vaultId: getVaultId(root), relativePath: '当前笔记.md' })).toBeNull()
      expect(resolveReference(home, { vaultId: getVaultId(other), relativePath: '当前笔记.md' })).toBe(join(other, '当前笔记.md'))
    } finally { rmSync(parent, { recursive: true, force: true }) }
  })

  test('Given 笔记已改名或删除，When 查询旧路径，Then 旧引用失效而新路径仍可解析', () => {
    const { parent, root, home } = fixture()
    try {
      const renamed = createVaultFileSystem(root).renameFile({ relativePath: '当前笔记.md', name: '新名称.md' })
      expect(renamed.vaultId).toBe(getVaultId(root))
      expect(resolveReference(home, { vaultId: getVaultId(root), relativePath: '当前笔记.md' })).toBeNull()
      expect(resolveReference(home, { vaultId: getVaultId(root), relativePath: '新名称.md' })).toBe(join(root, '新名称.md'))
      unlinkSync(join(root, '新名称.md'))
      expect(resolveReference(home, { vaultId: getVaultId(root), relativePath: '新名称.md' })).toBeNull()
    } finally { rmSync(parent, { recursive: true, force: true }) }
  })

  test('Given 越界、隐藏目录、非 Markdown、目录或软链接，When 请求引用，Then 不返回文件路径', () => {
    const { parent, root, home } = fixture()
    try {
      writeFileSync(join(parent, 'outside.md'), '外部文件')
      symlinkSync(join(parent, 'outside.md'), join(root, 'link.md'))
      mkdirSync(join(root, 'folder.md'))
      mkdirSync(join(root, '.hidden'))
      writeFileSync(join(root, '.hidden/secret.md'), '隐藏内容')
      writeFileSync(join(root, 'text.txt'), '非 Markdown')
      for (const relativePath of ['../outside.md', join(parent, 'outside.md'), '.hidden/secret.md', 'text.txt', 'folder.md', 'link.md']) {
        expect(resolveReference(home, { vaultId: getVaultId(root), relativePath })).toBeNull()
      }
    } finally { rmSync(parent, { recursive: true, force: true }) }
  })
})
