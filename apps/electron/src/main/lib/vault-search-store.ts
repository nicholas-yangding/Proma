import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { watch } from 'chokidar'
import type { FSWatcher } from 'chokidar'
import type { VaultSearchResponse, VaultSearchStatus } from '@proma/shared'
import { getSafeVaultTarget, isWithinRoot, isVisibleVaultPathSegment } from './vault-path-policy'
import { VaultTextIndex } from './vault-search-index'
import type { IndexedVaultNote } from './vault-search-index'

export type VaultIndexProgress = Pick<VaultSearchStatus, 'phase' | 'revision' | 'indexedFiles' | 'skippedFiles'>

const MAX_NOTE_BYTES = 16 * 1024 * 1024
const UPDATE_DELAY_MS = 50
const SLICE_MS = 12

function readNote(root: string, relativePath: string): IndexedVaultNote | 'skipped' | null {
  let target: ReturnType<typeof getSafeVaultTarget>
  try { target = getSafeVaultTarget(root, relativePath) } catch { return null }

  let fd: number | undefined
  try {
    if (!lstatSync(target.absolutePath).isFile() || realpathSync(target.absolutePath) !== target.absolutePath) return null
    fd = openSync(target.absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    const before = fstatSync(fd)
    if (!before.isFile()) return null
    if (before.size > MAX_NOTE_BYTES) return 'skipped'
    const bytes = Buffer.allocUnsafe(before.size)
    let offset = 0
    while (offset < bytes.length) {
      const length = readSync(fd, bytes, offset, bytes.length - offset, offset)
      if (!length) return 'skipped'
      offset += length
    }
    const after = fstatSync(fd)
    const current = lstatSync(target.absolutePath)
    if (realpathSync(target.absolutePath) !== target.absolutePath || !current.isFile()
      || after.ino !== current.ino || after.dev !== current.dev) return null
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) return 'skipped'
    return { relativePath, content: bytes.toString('utf8'), size: before.size, modifiedAt: before.mtimeMs }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error.code === 'ENOENT' || error.code === 'ELOOP')) return null
    return 'skipped'
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** 只在索引 Worker 中实例化。监听、文件读取与索引由同一个事件循环拥有。 */
export class VaultSearchStore {
  private readonly index = new VaultTextIndex()
  private readonly pending = new Set<string>()
  private readonly skipped = new Set<string>()
  private readonly watcher: FSWatcher
  private timer: ReturnType<typeof setTimeout> | undefined
  private notifyTimer: ReturnType<typeof setTimeout> | undefined
  private enumerated = false
  private closed = false
  private failed = false
  private revision = 0

  constructor(private readonly root: string, private readonly onChange: (progress: VaultIndexProgress) => void) {
    this.watcher = watch(root, {
      followSymlinks: false,
      atomic: 100,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
      ignored: (path, stats) => {
        if (!isWithinRoot(root, path)) return true
        const name = relative(root, path)
        return name.split(sep).some((part) => !isVisibleVaultPathSegment(part))
          || !!(stats?.isFile() && !name.toLowerCase().endsWith('.md'))
      },
    })
    this.watcher.on('add', this.enqueue).on('change', this.enqueue)
      .on('unlink', (path) => this.remove(path, false))
      .on('unlinkDir', (path) => this.remove(path, true))
      .on('ready', () => { this.enumerated = true; this.changed() })
      .on('error', () => { this.failed = true; this.changed() })
  }

  get progress(): VaultIndexProgress {
    return {
      phase: this.failed ? 'error' : this.enumerated && this.pending.size === 0 ? 'ready' : 'indexing',
      revision: this.revision,
      indexedFiles: this.index.size,
      skippedFiles: this.skipped.size,
    }
  }

  search(query: string): Pick<VaultSearchResponse, 'hits' | 'totalMatches'> {
    return this.failed ? { hits: [], totalMatches: 0 } : this.index.search(query)
  }

  async close(): Promise<void> {
    this.closed = true
    clearTimeout(this.timer)
    clearTimeout(this.notifyTimer)
    this.pending.clear()
    await this.watcher.close()
  }

  private toRelative(path: string): string { return relative(this.root, path).split(sep).join('/') }

  private enqueue = (path: string): void => {
    if (this.closed || this.failed || !isWithinRoot(this.root, path) || !path.toLowerCase().endsWith('.md')) return
    this.pending.add(this.toRelative(path))
    this.timer ??= setTimeout(this.drain, UPDATE_DELAY_MS)
  }

  private drain = (): void => {
    this.timer = undefined
    if (this.closed || this.failed) return
    const deadline = performance.now() + SLICE_MS
    for (const path of this.pending) {
      this.pending.delete(path)
      const note = readNote(this.root, path)
      if (note === 'skipped') this.skipped.add(path)
      else this.skipped.delete(path)
      if (note && note !== 'skipped') this.index.upsert(note)
      else this.index.remove(path)
      if (performance.now() >= deadline) break
    }
    this.changed()
    if (this.pending.size > 0) this.timer = setTimeout(this.drain, 0)
  }

  private remove(path: string, directory: boolean): void {
    if (this.closed || !isWithinRoot(this.root, path)) return
    const name = this.toRelative(path)
    if (directory) {
      const prefix = name ? `${name}/` : ''
      for (const paths of [this.pending, this.skipped]) {
        for (const item of paths) if (item.startsWith(prefix)) paths.delete(item)
      }
      this.index.removeDirectory(name)
      if (!name) this.failed = true
    } else {
      this.pending.delete(name)
      this.skipped.delete(name)
      this.index.remove(name)
    }
    this.changed()
  }

  private changed(): void {
    if (this.closed) return
    this.revision++
    this.notifyTimer ??= setTimeout(() => {
      this.notifyTimer = undefined
      this.onChange(this.progress)
    }, 100)
  }
}
