import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getSafeVaultFolderTarget,
  getSafeVaultTarget,
  isVisibleVaultPathSegment,
  normalizeRelativeMarkdownPath,
} from './vault-path-policy'

test('Given 路径段 When 判断可见性 Then 仅白名单点目录放行', () => {
  expect(isVisibleVaultPathSegment('notes')).toBe(true)
  expect(isVisibleVaultPathSegment('.agents')).toBe(true)
  expect(isVisibleVaultPathSegment('.claude')).toBe(true)
  expect(isVisibleVaultPathSegment('.obsidian')).toBe(false)
  expect(isVisibleVaultPathSegment('.git')).toBe(false)
  expect(isVisibleVaultPathSegment('.hidden')).toBe(false)
})

test('Given 白名单点目录中的 Markdown When 规范化路径 Then 读取路径被放行', () => {
  expect(normalizeRelativeMarkdownPath('.agents/proma/SKILL.md')).toBe('.agents/proma/SKILL.md')
  expect(normalizeRelativeMarkdownPath('.claude/commands/foo.md')).toBe('.claude/commands/foo.md')
  expect(normalizeRelativeMarkdownPath('notes/常规笔记.md')).toBe('notes/常规笔记.md')
})

test('Given 白名单外的点段、逃逸段或非 Markdown When 规范化路径 Then 拒绝', () => {
  expect(() => normalizeRelativeMarkdownPath('.obsidian/app.json')).toThrow('隐藏目录')
  expect(() => normalizeRelativeMarkdownPath('.hidden/note.md')).toThrow('隐藏目录')
  expect(() => normalizeRelativeMarkdownPath('.agents/.inner/note.md')).toThrow('隐藏目录')
  expect(() => normalizeRelativeMarkdownPath('.DS_Store')).toThrow('隐藏目录')
  expect(() => normalizeRelativeMarkdownPath('../escape.md')).toThrow('隐藏目录')
  expect(() => normalizeRelativeMarkdownPath('a//b.md')).toThrow('隐藏目录')
  expect(() => normalizeRelativeMarkdownPath('.agents/prompt.txt')).toThrow('仅支持 Markdown')
})

test('Given 文件夹路径 When 规范化 Then 白名单点目录放行且其余点目录拒绝', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'proma-vault-policy-')))
  try {
    expect(getSafeVaultFolderTarget(root, '.agents').relativePath).toBe('.agents')
    expect(getSafeVaultFolderTarget(root, '.claude/commands').relativePath).toBe('.claude/commands')
    expect(getSafeVaultFolderTarget(root, 'notes/子目录').relativePath).toBe('notes/子目录')
    expect(() => getSafeVaultFolderTarget(root, '.obsidian')).toThrow('隐藏目录')
    expect(() => getSafeVaultFolderTarget(root, '.agents/.inner')).toThrow('隐藏目录')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Given 白名单目录中的软链接文件 When 解析读取目标 Then 仍然拒绝越权访问', () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'proma-vault-symlink-')))
  const root = join(parent, 'vault')
  try {
    mkdirSync(join(root, '.agents'), { recursive: true })
    writeFileSync(join(parent, 'outside.md'), '越界内容')
    symlinkSync(join(parent, 'outside.md'), join(root, '.agents', 'link.md'), 'file')
    expect(() => getSafeVaultTarget(root, '.agents/link.md')).toThrow('软链接')
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})
