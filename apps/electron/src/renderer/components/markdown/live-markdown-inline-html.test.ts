import { describe, expect, test } from 'bun:test'
import { findInlineLiveMarkdownPreviews } from './live-markdown-preview-syntax'

describe('内联 HTML 的实时预览', () => {
  test('给定嵌套列表中的连续格式标签，保留列表标记并识别完整片段', () => {
    const line = '    - <span textColor="var(--color)"><strong>核心体验</strong></span><span>：</span>'
    const previews = findInlineLiveMarkdownPreviews(line)
    expect(previews.map((preview) => line.slice(preview.from, preview.to))).toEqual([
      '<span textColor="var(--color)"><strong>核心体验</strong></span>',
      '<span>：</span>',
    ])
    expect(previews.every((preview) => preview.kind === 'html')).toBe(true)
  })

  test('给定代码、转义、未闭合或错误嵌套标签，保留源码', () => {
    for (const line of ['`<strong>代码</strong>`', '\\<strong>转义</strong>', '<span>未闭合', '<span><strong>错误</span></strong>', '<span><img src="a.png"></span>', '<span>`代码`</span>']) {
      expect(findInlineLiveMarkdownPreviews(line)).toEqual([])
    }
  })

  test('给定 HTML 与普通 Markdown 公式，预览范围互不重叠', () => {
    const previews = findInlineLiveMarkdownPreviews('<strong>标题</strong> 和 $x$')
    expect(previews.map((preview) => preview.kind)).toEqual(['html', 'math'])
    expect(previews[0]!.to).toBeLessThan(previews[1]!.from)
  })
})
