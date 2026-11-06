import { VAULT_MAX_EDIT_BYTES, VAULT_SEARCH_MAX_QUERY_LENGTH } from '@proma/shared'
import type { VaultSearchHit, VaultSearchResponse } from '@proma/shared'

export interface IndexedVaultNote {
  relativePath: string
  content: string
  size: number
  modifiedAt: number
}

interface Document extends IndexedVaultNote {
  id: number
  title: string
  foldedTitle: string
  foldedBody: string
  grams: Uint32Array
}

interface Match {
  document: Document
  rank: number
  offset: number
  term: string
}

const MAX_HITS = 30
const SNIPPET_CONTEXT = 48
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function fold(text: string): string {
  return text.normalize('NFKC').toLowerCase()
}

function addGrams(text: string, grams: Set<number>): void {
  // 两个 UTF-16 单元直接编码为整数；中英文使用同一套倒排表。
  for (let i = 1; i < text.length; i++) {
    grams.add(((text.charCodeAt(i - 1) << 16) | text.charCodeAt(i)) >>> 0)
  }
}

function originalRange(text: string, offset: number, term: string): [number, number] {
  if (fold(text.slice(offset, offset + term.length)) === term) return [offset, offset + term.length]

  // 只为最终结果恢复原文坐标；合字、组合音标和全角文字不需要全库保存坐标表。
  let position = 0
  let start: number | undefined
  for (const { index, segment } of graphemes.segment(text)) {
    position += fold(segment).length
    if (start === undefined && position > offset) start = index
    if (start !== undefined && position >= offset + term.length) return [start, index + segment.length]
  }
  return [0, 0]
}

function toHit({ document, offset, term }: Match): VaultSearchHit {
  const text = document.content
  const [start, end] = offset < 0 ? [0, 0] : originalRange(text, offset, term)
  let from = Math.max(0, start - SNIPPET_CONTEXT)
  let to = Math.min(text.length, end + SNIPPET_CONTEXT)
  if (from > 0 && /[\uDC00-\uDFFF]/u.test(text[from] ?? '')) from--
  if (to < text.length && /[\uDC00-\uDFFF]/u.test(text[to] ?? '')) to++
  const prefix = from > 0 ? '…' : ''
  return {
    relativePath: document.relativePath,
    title: document.title,
    snippet: prefix + text.slice(from, to) + (to < text.length ? '…' : ''),
    matchStart: start - from + prefix.length,
    matchLength: end - start,
    editable: document.size <= VAULT_MAX_EDIT_BYTES,
  }
}

function compareMatches(a: Match, b: Match): number {
  return b.rank - a.rank
    || b.document.modifiedAt - a.document.modifiedAt
    || a.document.relativePath.localeCompare(b.document.relativePath)
}

/** Worker 内存索引。二元组只负责缩小候选，命中必须再经过完整词项校验。 */
export class VaultTextIndex {
  private nextId = 0
  private readonly paths = new Map<string, number>()
  private readonly documents = new Map<number, Document>()
  private readonly postings = new Map<number, Set<number>>()

  get size(): number { return this.documents.size }

  upsert(note: IndexedVaultNote): boolean {
    const existingId = this.paths.get(note.relativePath)
    const existing = existingId === undefined ? undefined : this.documents.get(existingId)
    if (existing?.content === note.content && existing.modifiedAt === note.modifiedAt && existing.size === note.size) return false
    this.remove(note.relativePath)

    const id = existingId ?? this.nextId++
    const title = note.relativePath.split('/').at(-1)!.replace(/\.md$/i, '')
    const foldedTitle = fold(title)
    const foldedBody = fold(note.content)
    const grams = new Set<number>()
    addGrams(foldedTitle, grams)
    addGrams(foldedBody, grams)
    this.paths.set(note.relativePath, id)
    this.documents.set(id, { ...note, id, title, foldedTitle, foldedBody, grams: Uint32Array.from(grams) })
    for (const gram of grams) {
      let ids = this.postings.get(gram)
      if (!ids) this.postings.set(gram, ids = new Set())
      ids.add(id)
    }
    return true
  }

  remove(relativePath: string): boolean {
    const id = this.paths.get(relativePath)
    if (id === undefined) return false
    const document = this.documents.get(id)!
    for (const gram of document.grams) {
      const ids = this.postings.get(gram)!
      ids.delete(id)
      if (ids.size === 0) this.postings.delete(gram)
    }
    this.paths.delete(relativePath)
    this.documents.delete(id)
    return true
  }

  removeDirectory(relativePath: string): boolean {
    const prefix = relativePath ? `${relativePath}/` : ''
    let changed = false
    for (const path of this.paths.keys()) {
      if (path.startsWith(prefix)) changed = this.remove(path) || changed
    }
    return changed
  }

  search(query: string): Pick<VaultSearchResponse, 'hits' | 'totalMatches'> {
    const empty = { hits: [], totalMatches: 0 }
    if (query.length > VAULT_SEARCH_MAX_QUERY_LENGTH) return empty
    const normalized = fold(query.trim())
    if (!normalized || normalized.length > VAULT_SEARCH_MAX_QUERY_LENGTH) return empty
    const terms = [...new Set(normalized.split(/\s+/u))]
    const grams = new Set<number>()
    for (const term of terms) addGrams(term, grams)
    const lists: Set<number>[] = []
    for (const gram of grams) {
      const postings = this.postings.get(gram)
      if (!postings) return empty
      lists.push(postings)
    }
    lists.sort((a, b) => a.size - b.size)
    const [smallest, ...filters] = lists
    const best: Match[] = []
    let totalMatches = 0
    for (const id of smallest ?? this.documents.keys()) {
      if (!filters.every((list) => list.has(id))) continue
      const document = this.documents.get(id)!
      let offset = -1
      let term = ''
      let titleMatches = 0
      let matched = true
      for (const word of terms) {
        const inTitle = document.foldedTitle.includes(word)
        const at = document.foldedBody.indexOf(word)
        if (!inTitle && at < 0) { matched = false; break }
        if (inTitle) titleMatches++
        if (at >= 0 && (offset < 0 || at < offset)) { offset = at; term = word }
      }
      if (!matched) continue
      totalMatches++
      const rank = document.foldedTitle === normalized ? terms.length + 1 : titleMatches
      const hit = { document, rank, offset, term }
      if (best.length === MAX_HITS && compareMatches(hit, best[MAX_HITS - 1]!) >= 0) continue
      const at = best.findIndex((item) => compareMatches(hit, item) < 0)
      if (at < 0) best.push(hit)
      else best.splice(at, 0, hit)
      if (best.length > MAX_HITS) best.pop()
    }
    return { hits: best.map(toHit), totalMatches }
  }
}
