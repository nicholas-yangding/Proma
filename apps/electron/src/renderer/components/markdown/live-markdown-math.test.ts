import { describe, expect, test } from 'bun:test'
import { findInlineLiveMarkdownPreviews } from './live-markdown-preview-syntax'
import { renderLiveMarkdownTableInline } from './live-markdown-table-inline'

describe('Markdown 实时预览中的美元公式', () => {
  test('同行双美元公式替换完整源码范围', () => {
    const source = '公式 $$x^2$$ 结束'
    expect(findInlineLiveMarkdownPreviews(source)).toEqual([
      { kind: 'math', from: source.indexOf('$'), to: source.lastIndexOf('$') + 1, content: 'x^2' },
    ])
  })

  test('表格单元格不会在公式旁显示分隔符', () => {
    const html = renderLiveMarkdownTableInline('公式 $$x^2$$ 结束')
    expect(html).toContain('公式 <span')
    expect(html).toContain('</span> 结束')
    expect(html).toContain('class="katex"')
    expect(html).not.toContain('$')
  })

  test('代码、转义和未闭合双美元符号保留原文', () => {
    expect(findInlineLiveMarkdownPreviews('`$$x$$` \\$5 $$y$')).toEqual([])
    expect(findInlineLiveMarkdownPreviews('$$$x$$$')).toEqual([])
  })

  test('同一行的单双美元公式独立配对，转义美元保留在公式内', () => {
    const source = '前文 $x$ 加 $$y+\\$2$$'
    expect(findInlineLiveMarkdownPreviews(source).map((preview) => source.slice(preview.from, preview.to)))
      .toEqual(['$x$', '$$y+\\$2$$'])
  })
})
