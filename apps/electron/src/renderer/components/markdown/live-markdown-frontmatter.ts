import { isMap, isScalar, isSeq, parseDocument, stringify } from 'yaml'

export type LiveMarkdownPropertyValue =
  | { kind: 'scalar'; text: string; date: boolean; empty: boolean; editableSource: string | null }
  | { kind: 'list'; items: readonly string[] }
  | { kind: 'source' }

export interface LiveMarkdownPropertyEntry {
  key: string
  value: LiveMarkdownPropertyValue
}

export interface LiveMarkdownFrontmatterRange {
  /** 结束分隔符所在行，从 1 开始。 */
  endLine: number
}

const SAFE_KEY_RE = /^[\p{L}_][\p{L}\p{N}_-]*$/u
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.+-]+Z?)?$/

export function getLeadingFrontmatterRange(lines: readonly string[]): LiveMarkdownFrontmatterRange | null {
  if (lines[0]?.replace(/^\uFEFF/, '') !== '---') return null
  const closingLine = lines.findIndex((line, index) => index > 0 && /^---[ \t]*$/.test(line))
  return closingLine > 0 ? { endLine: closingLine + 1 } : null
}

function readMapping(source: string) {
  try {
    const doc = parseDocument(source)
    return doc.errors.length === 0 && isMap(doc.contents) ? doc.contents : null
  } catch {
    // 极深的 YAML 也需要回退到原文。
    return null
  }
}

function parseFrontmatter(lines: readonly string[], range: LiveMarkdownFrontmatterRange) {
  // 保留起始分隔符，让 YAML range 与 CodeMirror 的 LF 偏移对齐。
  const source = lines.slice(0, range.endLine - 1).join('\n') + '\n'
  const mapping = readMapping(source)
  if (!mapping) return null

  const entries = []
  for (const pair of mapping.items) {
    const { key, value } = pair
    if (!isScalar(key) || typeof key.value !== 'string' || key.tag || key.anchor) return null

    let property: LiveMarkdownPropertyValue = { kind: 'source' }
    if (isScalar(value) && !value.tag && !value.anchor && isSimpleValue(value.value)) {
      const text = value.value === null ? '' : value.source ?? String(value.value)
      const keyStart = key.range?.[0]
      const valueEnd = value.range?.[1]
      const lineEnd = keyStart === undefined ? -1 : source.indexOf('\n', keyStart)
      const editableSource = !mapping.flow && keyStart !== undefined && valueEnd !== undefined
        && lineEnd !== -1 && valueEnd <= lineEnd && !/[\r\n]/.test(text)
        ? source.slice(keyStart, lineEnd)
        : null
      property = { kind: 'scalar', text, date: value.type === 'PLAIN' && DATE_RE.test(text), empty: value.value === null, editableSource }
    } else if (isSeq(value) && !value.tag && !value.anchor && value.items.every((item) =>
      isScalar(item) && !item.tag && !item.anchor && isSimpleValue(item.value))) {
      property = { kind: 'list', items: value.items.map((item) => isScalar(item) ? String(item.value ?? '') : '') }
    }
    entries.push({ key: key.value, value: property, pair })
  }
  return { source, entries }
}

function isSimpleValue(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

export function getLeadingFrontmatter(
  lines: readonly string[],
  range: LiveMarkdownFrontmatterRange,
): LiveMarkdownPropertyEntry[] | null {
  return parseFrontmatter(lines, range)?.entries.map(({ key, value }) => ({ key, value })) ?? null
}

interface PropertyChange {
  from: number
  to: number
  insert: string
}

/** 生成单字段编辑，检查当前 YAML 中的目标仍与面板读取时一致。 */
export function planPropertyEdit(
  lines: readonly string[],
  entry: LiveMarkdownPropertyEntry,
  edit: { key: string; text: string } | 'remove',
): PropertyChange[] {
  const range = getLeadingFrontmatterRange(lines)
  const parsed = range && parseFrontmatter(lines, range)
  const current = parsed?.entries.find(({ key }) => key === entry.key)
  if (!parsed || current?.value.kind !== 'scalar' || entry.value.kind !== 'scalar'
    || current.value.editableSource === null || current.value.editableSource !== entry.value.editableSource) return []

  const { key, value } = current.pair
  if (!isScalar(key) || !key.range || !isScalar(value) || !value.range) return []
  const [keyStart, keyEnd] = key.range
  const [valueStart, valueEnd] = value.range
  if (edit === 'remove') {
    const from = parsed.source.lastIndexOf('\n', keyStart - 1) + 1
    const to = parsed.source.indexOf('\n', valueEnd) + 1
    return [{ from, to, insert: '' }]
  }

  if (edit.key !== entry.key && (!SAFE_KEY_RE.test(edit.key) || parsed.entries.some(({ key }) => key === edit.key))) return []
  if (/[\r\n]/.test(edit.text)) return []
  const changes: PropertyChange[] = []
  if (edit.key !== entry.key) {
    const replacement = stringify(edit.key, { defaultStringType: key.type, lineWidth: 0 }).trimEnd()
    changes.push({ from: keyStart, to: keyEnd, insert: replacement })
  }
  if (edit.text !== current.value.text) {
    const type = typeof value.value
    const encoded = type === 'boolean' || type === 'number'
      ? edit.text.trim()
      : stringify(edit.text, { defaultStringType: value.type, lineWidth: 0 }).trimEnd()
    // 空值的零长度范围可能紧跟冒号；插入值时补上必要的空格。
    const prefix = valueStart === valueEnd && parsed.source[valueStart - 1] === ':' ? ' ' : ''
    const suffix = valueStart === valueEnd && parsed.source[valueStart] === '#' ? ' ' : ''
    changes.push({ from: valueStart, to: valueEnd, insert: prefix + encoded + suffix })
  }

  if (changes.length === 0) return []
  let updated = parsed.source
  for (const { from, to, insert } of changes.toReversed()) {
    updated = updated.slice(0, from) + insert + updated.slice(to)
  }
  const mapping = readMapping(updated)
  if (!mapping || mapping.items.length !== parsed.entries.length) return []
  const updatedValue = mapping.get(edit.key, true)
  if (!isScalar(updatedValue)) return []
  if (edit.text !== current.value.text) {
    const parsedValue: unknown = updatedValue.value
    if (typeof value.value === 'string' || value.value === null) {
      if (parsedValue !== edit.text) return []
    } else if (typeof parsedValue !== typeof value.value || updatedValue.source !== edit.text.trim()) {
      return []
    }
  }
  return changes
}
