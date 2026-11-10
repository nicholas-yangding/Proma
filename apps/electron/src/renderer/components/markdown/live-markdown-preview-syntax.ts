import { isMarkdownEscaped as isEscaped, readDollarMath } from '@/lib/markdown-math-syntax'

export type InlineLiveMarkdownPreview =
  | { kind: 'math' | 'autolink' | 'html'; from: number; to: number; content: string }
  | { kind: 'image'; from: number; to: number; src: string; alt: string; title: string }

/** Returns the closing delimiter for supported display math, if this line opens a block. */
export function getDisplayMathClosingDelimiter(line: string): '$$' | '\\]' | null {
  const trimmed = line.trim()
  if (trimmed === '$$') return '$$'
  if (trimmed === '\\[') return '\\]'
  return null
}

const voidHtmlTags = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
])

/**
 * Finds the last zero-based source line for an HTML block that starts on `start`.
 * This deliberately tracks only the opening tag name: it handles nested divs and
 * keeps Markdown outside a raw HTML block available to the normal renderer.
 */
export function findRawHtmlBlockEnd(lines: readonly string[], start: number): number | null {
  const first = lines[start]?.trim()
  if (!first || /^<https?:\/\//i.test(first)) return null
  const opening = /^<([a-z][\w:-]*)(?=\s|\/?>)[^>]*>/i.exec(first)
  if (!opening) return null
  const tag = opening[1]!.toLowerCase()
  if (voidHtmlTags.has(tag) || /\/>\s*$/.test(first)) return start

  const pattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi')
  let depth = 0
  for (let lineIndex = start; lineIndex < lines.length; lineIndex += 1) {
    let match: RegExpExecArray | null
    pattern.lastIndex = 0
    while ((match = pattern.exec(lines[lineIndex] ?? '')) !== null) {
      if (/^<\//.test(match[0])) depth -= 1
      else if (!/\/>$/.test(match[0])) depth += 1
      if (depth === 0) return lineIndex
    }
  }
  return null
}

/** Raw HTML must occupy a complete Markdown line before the live editor replaces it with a widget. */
export function isStandaloneRawMarkdownHtml(line: string): boolean {
  return findRawHtmlBlockEnd([line], 0) === 0
}

function inlineCodeRanges(source: string): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = []
  let opening: { from: number; length: number } | null = null
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '`' || isEscaped(source, index)) continue
    let end = index + 1
    while (source[end] === '`') end += 1
    const length = end - index
    if (!opening) opening = { from: index, length }
    else if (opening.length === length) {
      ranges.push({ from: opening.from, to: end })
      opening = null
    }
    index = end - 1
  }
  return ranges
}

function overlapsInlineCode(ranges: Array<{ from: number; to: number }>, from: number, to: number): boolean {
  return ranges.some((range) => from < range.to && to > range.from)
}

/** 只预览完整配对的内联格式标签，未闭合或跨行标签保留源码。 */
function findInlineHtmlPreviews(line: string, codeRanges: Array<{ from: number; to: number }>): InlineLiveMarkdownPreview[] {
  const previews: InlineLiveMarkdownPreview[] = []
  const tags = /<\/?(?:span|strong|b|em|i|s|del|u|mark|sub|sup)(?=\s|\/?>)(?:[^>"']|"[^"]*"|'[^']*')*>/gi
  const stack: string[] = []
  let start = -1
  for (const match of line.matchAll(tags)) {
    const from = match.index
    const to = from + match[0].length
    if (isEscaped(line, from) || overlapsInlineCode(codeRanges, from, to)) continue
    const name = /^<\/?([\w-]+)/.exec(match[0])?.[1]?.toLowerCase()
    if (!name) continue
    if (/^<\//.test(match[0])) {
      if (stack.at(-1) !== name) { stack.length = 0; start = -1; continue }
      stack.pop()
      if (stack.length === 0 && start >= 0) {
        const content = line.slice(start, to)
        const allTags = content.matchAll(/<\/?([a-z][\w:-]*)(?=\s|\/?>)/gi)
        const supportedTags = new Set(['span', 'strong', 'b', 'em', 'i', 's', 'del', 'u', 'mark', 'sub', 'sup'])
        if (!overlapsInlineCode(codeRanges, start, to) && [...allTags].every((tag) => supportedTags.has(tag[1]!.toLowerCase()))) {
          previews.push({ kind: 'html', from: start, to, content })
        }
        start = -1
      }
    } else if (!/\/\s*>$/.test(match[0])) {
      if (stack.length === 0) start = from
      stack.push(name)
    }
  }
  return previews
}

/**
 * Finds the inline syntaxes that ink-mde leaves literal in reading mode.
 * Ranges include the delimiters so CodeMirror can replace the complete source span.
 */
export function findInlineLiveMarkdownPreviews(line: string): InlineLiveMarkdownPreview[] {
  const previews: InlineLiveMarkdownPreview[] = []
  const codeRanges = inlineCodeRanges(line)
  previews.push(...findInlineHtmlPreviews(line, codeRanges))
  for (let from = line.indexOf('$'); from !== -1; from = line.indexOf('$', from + 1)) {
    if (overlapsInlineCode(codeRanges, from, from + 1)) continue
    const math = readDollarMath(line, from)
    if (!math || overlapsInlineCode(codeRanges, from, math.to)) continue
    previews.push({ kind: 'math', from, to: math.to, content: math.content })
    from = math.to - 1
  }

  for (const match of line.matchAll(/\\\(([^\n]*?)\\\)/g)) {
    const from = match.index
    const to = from + match[0].length
    if (isEscaped(line, from) || overlapsInlineCode(codeRanges, from, to)) continue
    previews.push({ kind: 'math', from, to, content: match[1]! })
  }

  const imagePattern = /!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\)/g
  let image: RegExpExecArray | null
  while ((image = imagePattern.exec(line)) !== null) {
    const from = image.index
    const to = image.index + image[0]!.length
    if (isEscaped(line, from) || overlapsInlineCode(codeRanges, from, to)) continue
    previews.push({
      kind: 'image',
      from,
      to,
      src: image[2] ?? image[3] ?? '',
      alt: image[1] ?? '',
      title: image[4] ?? image[5] ?? image[6] ?? '',
    })
  }

  const autoLinkPattern = /<(https?:\/\/[^\s<>]+)>/g
  let autoLink: RegExpExecArray | null
  while ((autoLink = autoLinkPattern.exec(line)) !== null) {
    const from = autoLink.index
    const to = autoLink.index + autoLink[0]!.length
    if (isEscaped(line, from) || overlapsInlineCode(codeRanges, from, to)) continue
    previews.push({
      kind: 'autolink',
      from,
      to,
      content: autoLink[1]!,
    })
  }

  // 图片目标中可能包含尖括号 URL；优先保留完整图片范围，防止 replacement decorations 重叠。
  return previews
    .sort((left, right) => left.from - right.from || right.to - left.to)
    .filter((preview, index, sorted) => !sorted.slice(0, index).some((previous) => previous.from <= preview.from && previous.to >= preview.to))
}
