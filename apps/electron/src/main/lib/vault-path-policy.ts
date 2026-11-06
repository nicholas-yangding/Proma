import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export const HIDDEN_DIRECTORY_PREFIX = '.'

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

export function normalizeRelativeMarkdownPath(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) {
    throw new Error('Vault 相对路径不能为空')
  }
  if (isAbsolute(value) || isWindowsAbsolutePath(value)) {
    throw new Error('Vault 不接受绝对路径')
  }

  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '')
  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith(HIDDEN_DIRECTORY_PREFIX))) {
    throw new Error('Vault 路径不能包含隐藏目录、空段或上级目录')
  }
  if (!normalized.toLowerCase().endsWith('.md')) {
    throw new Error('Vault 仅支持 Markdown (.md) 文件')
  }
  return parts.join('/')
}

export function isWithinRoot(rootPath: string, targetPath: string): boolean {
  const fromRoot = relative(rootPath, targetPath)
  return fromRoot === '' || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot))
}

function normalizeRelativeVaultFolderPath(value: string): string {
  if (typeof value !== 'string' || value.includes('\0')) {
    throw new Error('Vault 文件夹路径非法')
  }
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
  if (!normalized) return ''
  if (isAbsolute(normalized) || isWindowsAbsolutePath(normalized)) {
    throw new Error('Vault 不接受绝对路径')
  }
  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith(HIDDEN_DIRECTORY_PREFIX))) {
    throw new Error('Vault 文件夹路径不能包含隐藏目录、空段或上级目录')
  }
  return parts.join('/')
}

export function assertVaultRoot(rootPath: string): string {
  const resolved = realpathSync(resolve(rootPath))
  if (!statSync(resolved).isDirectory()) {
    throw new Error('Vault 根路径不是目录')
  }
  return resolved
}

export function getSafeVaultPath(rootPath: string, relativePath: string): { absolutePath: string; relativePath: string } {
  const absolutePath = resolve(rootPath, relativePath)
  if (!isWithinRoot(rootPath, absolutePath)) {
    throw new Error('Vault 路径超出授权根目录')
  }

  let current = rootPath
  for (const segment of relativePath.split('/').filter(Boolean)) {
    current = join(current, segment)
    if (!existsSync(current)) continue
    const stats = lstatSync(current)
    if (stats.isSymbolicLink()) {
      throw new Error('Vault 不允许通过软链接访问文件')
    }
  }

  return { absolutePath, relativePath }
}

export function getSafeVaultTarget(rootPath: string, relativePath: string): { absolutePath: string; relativePath: string } {
  return getSafeVaultPath(rootPath, normalizeRelativeMarkdownPath(relativePath))
}

export function getSafeVaultFolderTarget(rootPath: string, relativePath: string): { absolutePath: string; relativePath: string } {
  return getSafeVaultPath(rootPath, normalizeRelativeVaultFolderPath(relativePath))
}
