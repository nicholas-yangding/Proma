interface DollarMath {
  to: number
  content: string
  delimiterLength: 1 | 2
}

export function isMarkdownEscaped(source: string, offset: number): boolean {
  let slashes = 0
  for (let index = offset - 1; source[index] === '\\'; index--) slashes++
  return slashes % 2 === 1
}

export function readDollarMath(source: string, start: number, limit = source.length): DollarMath | null {
  if (start >= limit || source[start] !== '$' || source[start - 1] === '$' || isMarkdownEscaped(source, start)) return null
  const delimiterLength = start + 1 < limit && source[start + 1] === '$' ? 2 : 1
  const contentStart = start + delimiterLength
  if (contentStart < limit && source[contentStart] === '$') return null

  for (let cursor = contentStart; cursor < limit; cursor++) {
    if (source[cursor] !== '$' || isMarkdownEscaped(source, cursor)) continue
    let to = cursor + 1
    while (to < limit && source[to] === '$') to++
    if (to - cursor === delimiterLength && cursor > contentStart) {
      return { to, content: source.slice(contentStart, cursor), delimiterLength }
    }
    cursor = to - 1
  }
  return null
}

export function readStandaloneDollarMath(line: string): string | null {
  const indent = /^ {0,3}(?=\$\$)/.exec(line)
  if (!indent) return null
  const math = readDollarMath(line, indent[0].length)
  return math?.delimiterLength === 2 && !line.slice(math.to).trim() ? math.content.trim() : null
}
